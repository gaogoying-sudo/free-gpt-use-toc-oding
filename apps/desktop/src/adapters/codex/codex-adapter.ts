import { BridgeConfig } from "../../types/config";
import { Rect, addPoint } from "../../types/geometry";
import { ClipboardService } from "../../services/clipboard/clipboard-service";
import { Logger } from "../../services/logger/logger";
import { ScreenProbeService } from "../../services/screen-probe/screen-probe-service";
import { WindowManagerService } from "../../services/window-manager/window-manager-service";
import { AutomationService } from "../../services/automation/automation-service";
import { sleep } from "../../services/utils";
import { ConversationAdapter } from "../conversation-adapter";

export class CodexAdapter implements ConversationAdapter {
  constructor(
    private readonly getConfig: () => BridgeConfig,
    private readonly windowManager: WindowManagerService,
    private readonly automation: AutomationService,
    private readonly clipboard: ClipboardService,
    private readonly screenProbe: ScreenProbeService,
    private readonly logger: Logger
  ) {}

  async sendMessage(text: string, signal?: AbortSignal): Promise<void> {
    const config = this.getConfig();
    const anchors = config.calibration.codex;
    if (!anchors.inputAnchor || !anchors.responseRoi) {
      throw new Error("Codex calibration is incomplete");
    }

    await this.windowManager.focusCodex(signal);
    await this.automation.leftClick(anchors.inputAnchor, signal);
    this.clipboard.setText(text);
    await this.automation.paste(signal);

    const hasInput = await this.probeInputHasContent(signal);
    if (!hasInput) {
      throw new Error("Codex input validation failed: pasted content is empty");
    }

    await this.automation.pressEnter(signal);
    await sleep(config.timing.actionDelayMs, signal);

    const inputRoi = this.rectAroundPoint(anchors.inputAnchor, 520, 60);

    const [inputCleared, timelineChanged, inputAreaChanged] = await Promise.all([
      this.probeInputCleared(signal),
      this.screenProbe.detectChange({
        roi: anchors.responseRoi,
        timeoutMs: 8_000,
        pollIntervalMs: config.timing.pollingIntervalMs,
        minDeltaRatio: config.screenProbe.changeDeltaThreshold,
        signal
      }),
      this.screenProbe.detectChange({
        roi: inputRoi,
        timeoutMs: 5_000,
        pollIntervalMs: config.timing.pollingIntervalMs,
        minDeltaRatio: config.screenProbe.changeDeltaThreshold,
        signal
      })
    ]);

    const passedSignals = [inputCleared, timelineChanged, inputAreaChanged].filter(Boolean).length;
    this.logger.info("Codex send signal summary", {
      inputCleared,
      timelineChanged,
      inputAreaChanged,
      passedSignals,
      minRequired: anchors.minSendSignals
    });

    if (passedSignals < anchors.minSendSignals) {
      throw new Error(`Codex send validation failed: only ${passedSignals} signals`);
    }
  }

  async waitForLatestResponseComplete(signal?: AbortSignal): Promise<void> {
    const config = this.getConfig();
    const anchors = config.calibration.codex;
    if (!anchors.responseRoi || !anchors.inputAnchor) {
      throw new Error("Codex calibration is incomplete for wait stage");
    }

    await this.windowManager.focusCodex(signal);

    const stable = await this.screenProbe.waitForStability({
      roi: anchors.responseRoi,
      timeoutMs: config.timeout.waitForCompletionMs,
      stableWindowMs: config.timing.stabilityWindowMs,
      pollIntervalMs: config.timing.pollingIntervalMs,
      maxDeltaRatio: config.screenProbe.stableDeltaThreshold,
      signal
    });

    if (!stable) {
      throw new Error("Codex response did not stabilize in time");
    }

    const inputReady = await this.screenProbe.waitForStability({
      roi: this.rectAroundPoint(anchors.inputAnchor, 560, 64),
      timeoutMs: 10_000,
      stableWindowMs: Math.max(1000, Math.floor(config.timing.stabilityWindowMs / 2)),
      pollIntervalMs: config.timing.pollingIntervalMs,
      maxDeltaRatio: config.screenProbe.stableDeltaThreshold,
      signal
    });

    const responseStill = await this.screenProbe.waitForStability({
      roi: anchors.responseRoi,
      timeoutMs: 10_000,
      stableWindowMs: Math.max(1000, Math.floor(config.timing.stabilityWindowMs / 2)),
      pollIntervalMs: config.timing.pollingIntervalMs,
      maxDeltaRatio: config.screenProbe.stableDeltaThreshold,
      signal
    });

    const passedSignals = [stable, inputReady, responseStill].filter(Boolean).length;
    if (passedSignals < 2) {
      throw new Error(`Codex completion validation failed: ${passedSignals} signals`);
    }
  }

  async copyLatestReply(signal?: AbortSignal): Promise<string> {
    const config = this.getConfig();
    const anchors = config.calibration.codex;
    if (!anchors.inputAnchor || !anchors.hoverBandAnchor || !anchors.copyCandidateAnchor) {
      throw new Error("Codex calibration is incomplete for copy stage");
    }

    await this.windowManager.focusCodex(signal);
    await this.automation.leftClick(anchors.inputAnchor, signal);
    await this.automation.pressCommandDown(signal);

    for (let attempt = 1; attempt <= config.retries.hover; attempt += 1) {
      this.logger.info("Codex hover-copy attempt", { attempt });
      const beforeHash = this.clipboard.getHash();

      for (const hoverOffset of anchors.hoverOffsets) {
        const hoverPoint = addPoint(anchors.hoverBandAnchor, hoverOffset);
        await this.automation.hover(hoverPoint, config.timing.hoverDwellMs, signal);

        for (const copyOffset of anchors.copyCandidateOffsets) {
          const copyPoint = addPoint(anchors.copyCandidateAnchor, copyOffset);
          await this.automation.leftClick(copyPoint, signal);

          const result = await this.clipboard.waitForHashChange(beforeHash, {
            retries: 1,
            delayMs: config.timing.copyCheckDelayMs,
            requireNonEmpty: true,
            signal
          });

          if (result.changed && result.text.trim().length > 0) {
            this.logger.info("Codex copy succeeded", {
              hoverPoint,
              copyPoint,
              length: result.text.length
            });
            return result.text;
          }
        }
      }
    }

    throw new Error("Codex hover reveal copy failed after max retries");
  }

  private async probeInputHasContent(signal?: AbortSignal): Promise<boolean> {
    const backup = this.clipboard.getText();
    await this.automation.selectAll(signal);
    await this.automation.copy(signal);
    const content = this.clipboard.getText();
    this.clipboard.setText(backup);
    return content.trim().length > 0;
  }

  private async probeInputCleared(signal?: AbortSignal): Promise<boolean> {
    const backup = this.clipboard.getText();
    await this.automation.selectAll(signal);
    await this.automation.copy(signal);
    const content = this.clipboard.getText();
    this.clipboard.setText(backup);
    return content.trim().length === 0;
  }

  private rectAroundPoint(point: { x: number; y: number }, width: number, height: number): Rect {
    return {
      x: Math.round(point.x - width / 2),
      y: Math.round(point.y - height / 2),
      width,
      height
    };
  }
}
