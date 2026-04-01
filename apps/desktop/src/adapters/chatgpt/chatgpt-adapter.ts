import { BridgeConfig } from "../../types/config";
import { Rect, addPoint } from "../../types/geometry";
import { ClipboardService } from "../../services/clipboard/clipboard-service";
import { Logger } from "../../services/logger/logger";
import { ScreenProbeService } from "../../services/screen-probe/screen-probe-service";
import { WindowManagerService } from "../../services/window-manager/window-manager-service";
import { AutomationService } from "../../services/automation/automation-service";
import { sleep } from "../../services/utils";
import { ConversationAdapter } from "../conversation-adapter";

export class ChatGPTAdapter implements ConversationAdapter {
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
    const anchors = config.calibration.chatgpt;
    if (!anchors.inputAnchor || !anchors.sendButtonAnchor || !anchors.responseRoi) {
      throw new Error("ChatGPT calibration is incomplete");
    }

    await this.windowManager.focusChatGPT(signal);
    await this.automation.leftClick(anchors.inputAnchor, signal);
    this.clipboard.setText(text);
    await this.automation.paste(signal);

    const hasInput = await this.probeInputHasContent(signal);
    if (!hasInput) {
      throw new Error("ChatGPT input validation failed: pasted content is empty");
    }

    await this.automation.leftClick(anchors.sendButtonAnchor, signal);
    await sleep(config.timing.actionDelayMs, signal);

    const sendButtonRoi = this.rectAroundPoint(anchors.sendButtonAnchor, 40, 34);

    const [inputCleared, buttonChanged, timelineChanged] = await Promise.all([
      this.probeInputCleared(signal),
      this.screenProbe.detectChange({
        roi: sendButtonRoi,
        timeoutMs: 5_000,
        pollIntervalMs: config.timing.pollingIntervalMs,
        minDeltaRatio: config.screenProbe.changeDeltaThreshold,
        signal
      }),
      this.screenProbe.detectChange({
        roi: anchors.responseRoi,
        timeoutMs: 8_000,
        pollIntervalMs: config.timing.pollingIntervalMs,
        minDeltaRatio: config.screenProbe.changeDeltaThreshold,
        signal
      })
    ]);

    const passedSignals = [inputCleared, buttonChanged, timelineChanged].filter(Boolean).length;
    this.logger.info("ChatGPT send signal summary", {
      inputCleared,
      buttonChanged,
      timelineChanged,
      passedSignals,
      minRequired: anchors.minSendSignals
    });

    if (passedSignals < anchors.minSendSignals) {
      throw new Error(`ChatGPT send validation failed: only ${passedSignals} signals`);
    }
  }

  async waitForLatestResponseComplete(signal?: AbortSignal): Promise<void> {
    const config = this.getConfig();
    const anchors = config.calibration.chatgpt;
    if (!anchors.responseRoi || !anchors.sendButtonAnchor || !anchors.copySearchAnchor) {
      throw new Error("ChatGPT calibration is incomplete for wait stage");
    }

    await this.windowManager.focusChatGPT(signal);

    const stable = await this.screenProbe.waitForStability({
      roi: anchors.responseRoi,
      timeoutMs: config.timeout.waitForCompletionMs,
      stableWindowMs: config.timing.stabilityWindowMs,
      pollIntervalMs: config.timing.pollingIntervalMs,
      maxDeltaRatio: config.screenProbe.stableDeltaThreshold,
      signal
    });

    if (!stable) {
      throw new Error("ChatGPT response did not stabilize in time");
    }

    const sendButtonIdle = await this.screenProbe.waitForStability({
      roi: this.rectAroundPoint(anchors.sendButtonAnchor, 42, 34),
      timeoutMs: 12_000,
      stableWindowMs: Math.max(1000, Math.floor(config.timing.stabilityWindowMs / 2)),
      pollIntervalMs: config.timing.pollingIntervalMs,
      maxDeltaRatio: config.screenProbe.stableDeltaThreshold,
      signal
    });

    const copyBandStable = await this.screenProbe.waitForStability({
      roi: this.rectAroundPoint(anchors.copySearchAnchor, 180, 44),
      timeoutMs: 12_000,
      stableWindowMs: Math.max(1000, Math.floor(config.timing.stabilityWindowMs / 2)),
      pollIntervalMs: config.timing.pollingIntervalMs,
      maxDeltaRatio: config.screenProbe.stableDeltaThreshold,
      signal
    });

    const passedSignals = [stable, sendButtonIdle, copyBandStable].filter(Boolean).length;
    if (passedSignals < 2) {
      throw new Error(`ChatGPT completion validation failed: ${passedSignals} signals`);
    }
  }

  async copyLatestReply(signal?: AbortSignal): Promise<string> {
    const config = this.getConfig();
    const anchors = config.calibration.chatgpt;
    if (!anchors.scrollBottomAnchor || !anchors.copySearchAnchor) {
      throw new Error("ChatGPT calibration is incomplete for copy stage");
    }

    await this.windowManager.focusChatGPT(signal);
    await this.automation.leftClick(anchors.scrollBottomAnchor, signal);
    await sleep(config.timing.actionDelayMs, signal);

    const beforeHash = this.clipboard.getHash();

    for (let attempt = 1; attempt <= config.retries.copy; attempt += 1) {
      this.logger.info("ChatGPT copy attempt", { attempt });

      for (const offset of anchors.copyCandidateOffsets) {
        const point = addPoint(anchors.copySearchAnchor, offset);
        await this.automation.hover(point, config.timing.hoverDwellMs, signal);
        await this.automation.leftClick(point, signal);

        const result = await this.clipboard.waitForHashChange(beforeHash, {
          retries: 1,
          delayMs: config.timing.copyCheckDelayMs,
          requireNonEmpty: true,
          signal
        });

        if (result.changed && result.text.trim().length > 0) {
          this.logger.info("ChatGPT copy succeeded", {
            point,
            length: result.text.length
          });
          return result.text;
        }
      }

      await this.automation.copy(signal);
      const fallback = await this.clipboard.waitForHashChange(beforeHash, {
        retries: 1,
        delayMs: config.timing.copyCheckDelayMs,
        requireNonEmpty: true,
        signal
      });

      if (fallback.changed && fallback.text.trim().length > 0) {
        this.logger.info("ChatGPT copy succeeded by fallback cmd+c", {
          length: fallback.text.length
        });
        return fallback.text;
      }
    }

    throw new Error("ChatGPT copy failed after max retries");
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
