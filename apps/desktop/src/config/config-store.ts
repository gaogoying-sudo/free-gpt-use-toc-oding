import fs from "node:fs/promises";
import path from "node:path";
import { BridgeConfig } from "../types/config";
import { Point, Rect } from "../types/geometry";
import { DEFAULT_CONFIG } from "./default-config";

const CONFIG_FILE_NAME = "config.json";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const asPoint = (value: unknown): Point | null => {
  if (!isObject(value)) {
    return null;
  }

  const x = asNumber(value.x);
  const y = asNumber(value.y);
  if (x === null || y === null) {
    return null;
  }

  return { x, y };
};

const asRect = (value: unknown): Rect | null => {
  if (!isObject(value)) {
    return null;
  }

  const x = asNumber(value.x);
  const y = asNumber(value.y);
  const width = asNumber(value.width);
  const height = asNumber(value.height);
  if (x === null || y === null || width === null || height === null) {
    return null;
  }

  return { x, y, width, height };
};

const deepMerge = <T>(base: T, patch: unknown): T => {
  if (!isObject(base) || !isObject(patch)) {
    return (patch ?? base) as T;
  }

  const output: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(patch)) {
    const current = output[key];
    if (Array.isArray(value)) {
      output[key] = value;
      continue;
    }

    if (isObject(value) && isObject(current)) {
      output[key] = deepMerge(current, value);
      continue;
    }

    output[key] = value;
  }

  return output as T;
};

const isLeftCalibrated = (config: BridgeConfig): boolean => {
  const left = config.calibration.chatgpt;
  return Boolean(
    left.inputAnchor &&
      left.sendButtonAnchor &&
      left.scrollBottomAnchor &&
      left.copySearchAnchor &&
      left.latestReplyStableRoi
  );
};

const isRightCalibrated = (config: BridgeConfig): boolean => {
  const right = config.calibration.codex;
  return Boolean(
    right.inputAnchor &&
      right.paneActivationPoint &&
      right.replyAreaActivationPoint &&
      right.hoverBandAnchor &&
      right.copyCandidatePoints.length > 0 &&
      right.stableRoi &&
      (right.bottomAnchor || right.bottomDetectionRoi)
  );
};

const migrateLegacyConfig = (config: BridgeConfig, rawParsed: unknown): BridgeConfig => {
  const parsed = isObject(rawParsed) ? rawParsed : {};

  const parsedRetries = isObject(parsed.retries) ? parsed.retries : {};
  const legacyCopy = asNumber(parsedRetries.copy);
  const legacyHover = asNumber(parsedRetries.hover);
  if (legacyCopy !== null) {
    config.retries.maxCopyAttempts = legacyCopy;
  }
  if (legacyHover !== null) {
    config.retries.maxHoverAttempts = legacyHover;
  }

  const parsedTiming = isObject(parsed.timing) ? parsed.timing : {};
  const legacyStabilityWindow = asNumber(parsedTiming.stabilityWindowMs);
  const legacyCopyCheckDelay = asNumber(parsedTiming.copyCheckDelayMs);
  if (legacyStabilityWindow !== null) {
    config.timing.roiStabilityWindowMs = legacyStabilityWindow;
  }
  if (legacyCopyCheckDelay !== null) {
    config.timing.clipboardVerifyTimeoutMs = Math.max(
      config.timing.clipboardVerifyTimeoutMs,
      legacyCopyCheckDelay * 3
    );
  }

  const parsedScreenProbe = isObject(parsed.screenProbe) ? parsed.screenProbe : {};
  const legacyStableThreshold = asNumber(parsedScreenProbe.stableDeltaThreshold);
  if (legacyStableThreshold !== null) {
    config.screenProbe.roiPixelDiffThreshold = legacyStableThreshold;
  }

  const parsedCalibration = isObject(parsed.calibration) ? parsed.calibration : {};
  const parsedCodex = isObject(parsedCalibration.codex) ? parsedCalibration.codex : {};
  const parsedChatGPT = isObject(parsedCalibration.chatgpt) ? parsedCalibration.chatgpt : {};

  if (!config.calibration.chatgpt.latestReplyStableRoi && config.calibration.chatgpt.responseRoi) {
    config.calibration.chatgpt.latestReplyStableRoi = config.calibration.chatgpt.responseRoi;
  }

  if (!config.calibration.codex.stableRoi && config.calibration.codex.responseRoi) {
    config.calibration.codex.stableRoi = config.calibration.codex.responseRoi;
  }

  const legacyCopyAnchor = asPoint(parsedCodex.copyCandidateAnchor);
  if (legacyCopyAnchor && config.calibration.codex.copyCandidatePoints.length === 0) {
    const offsetSource = Array.isArray(parsedCodex.copyCandidateOffsets)
      ? parsedCodex.copyCandidateOffsets
      : [
          { x: -32, y: 0 },
          { x: 0, y: 0 },
          { x: 32, y: 0 }
        ];

    const offsets = offsetSource
      .map((entry) => asPoint(entry))
      .filter((entry): entry is Point => Boolean(entry));

    config.calibration.codex.copyCandidatePoints = offsets.map((offset) => ({
      x: Math.round(legacyCopyAnchor.x + offset.x),
      y: Math.round(legacyCopyAnchor.y + offset.y)
    }));
  }

  if (!config.calibration.codex.paneActivationPoint) {
    const fallback = asPoint(parsedCodex.paneActivationPoint) ?? config.calibration.codex.inputAnchor;
    if (fallback) {
      config.calibration.codex.paneActivationPoint = fallback;
    }
  }

  if (!config.calibration.codex.replyAreaActivationPoint) {
    const fallback = asPoint(parsedCodex.replyAreaActivationPoint) ?? config.calibration.codex.hoverBandAnchor;
    if (fallback) {
      config.calibration.codex.replyAreaActivationPoint = fallback;
    }
  }

  if (!config.calibration.codex.bottomAnchor) {
    const legacyBottom = asPoint(parsedCodex.bottomAnchor);
    if (legacyBottom) {
      config.calibration.codex.bottomAnchor = legacyBottom;
    }
  }

  if (!config.calibration.chatgpt.latestReplyStableRoi) {
    const legacyRoi = asRect(parsedChatGPT.responseRoi);
    if (legacyRoi) {
      config.calibration.chatgpt.latestReplyStableRoi = legacyRoi;
    }
  }

  config.calibration.leftVersion = 2;
  config.calibration.rightVersion = 2;
  config.calibration.chatgpt.version = 2;
  config.calibration.codex.version = 2;
  config.calibration.calibrated = isLeftCalibrated(config) && isRightCalibrated(config);

  return config;
};

export class ConfigStore {
  private readonly configPath: string;
  private readonly logsDir: string;

  constructor(private readonly userDataPath: string) {
    this.configPath = path.join(userDataPath, CONFIG_FILE_NAME);
    this.logsDir = path.join(userDataPath, "logs");
  }

  getConfigPath(): string {
    return this.configPath;
  }

  getLogsDir(): string {
    return this.logsDir;
  }

  async ensurePaths(): Promise<void> {
    await fs.mkdir(this.userDataPath, { recursive: true });
    await fs.mkdir(this.logsDir, { recursive: true });
  }

  async load(): Promise<BridgeConfig> {
    await this.ensurePaths();

    try {
      const raw = await fs.readFile(this.configPath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      const merged = deepMerge(DEFAULT_CONFIG, parsed);
      const migrated = migrateLegacyConfig(merged, parsed);
      await this.save(migrated);
      return migrated;
    } catch (error) {
      await this.save(DEFAULT_CONFIG);
      return structuredClone(DEFAULT_CONFIG);
    }
  }

  async save(config: BridgeConfig): Promise<void> {
    await this.ensurePaths();
    const raw = JSON.stringify(config, null, 2);
    await fs.writeFile(this.configPath, `${raw}\n`, "utf8");
  }
}
