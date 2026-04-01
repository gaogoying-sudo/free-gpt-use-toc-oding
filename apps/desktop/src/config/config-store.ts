import fs from "node:fs/promises";
import path from "node:path";
import { BridgeConfig } from "../types/config";
import { DEFAULT_CONFIG } from "./default-config";

const CONFIG_FILE_NAME = "config.json";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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
      return deepMerge(DEFAULT_CONFIG, parsed);
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
