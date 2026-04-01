import { BridgeConfig } from "../../types/config";
import { Rect, Point, addPoint } from "../../types/geometry";
import { STEP_CODES, StepError } from "../../types/step-codes";
import { ClipboardService } from "../../services/clipboard/clipboard-service";
import { Logger } from "../../services/logger/logger";
import { ScreenProbeService } from "../../services/screen-probe/screen-probe-service";
import { WindowManagerService } from "../../services/window-manager/window-manager-service";
import { AutomationService } from "../../services/automation/automation-service";
import { sleep } from "../../services/utils";
import { ConversationAdapter } from "../conversation-adapter";

interface HoverCopyResult {
  text: string | null;
  nextCandidateIndex: number;
}

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
    const responseRoi = this.resolveResponseRoi();

    if (!anchors.inputAnchor || !responseRoi) {
      throw new Error("Codex calibration is incomplete");
    }

    await this.focusVSCodeWindow(signal);
    await this.ensureCodexPaneActive(signal);

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
        roi: responseRoi,
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
    const responseRoi = this.resolveResponseRoi();

    if (!responseRoi || !anchors.inputAnchor) {
      throw new Error("Codex calibration is incomplete for wait stage");
    }

    await this.focusVSCodeWindow(signal);

    const stable = await this.screenProbe.waitForStability({
      roi: responseRoi,
      timeoutMs: config.timeout.waitForCompletionMs,
      stableWindowMs: config.timing.roiStabilityWindowMs,
      pollIntervalMs: config.timing.pollingIntervalMs,
      maxDeltaRatio: config.screenProbe.roiPixelDiffThreshold,
      signal
    });

    if (!stable) {
      throw new Error("Codex response did not stabilize in time");
    }

    const inputReady = await this.screenProbe.waitForStability({
      roi: this.rectAroundPoint(anchors.inputAnchor, 560, 64),
      timeoutMs: 10_000,
      stableWindowMs: Math.max(1000, Math.floor(config.timing.roiStabilityWindowMs / 2)),
      pollIntervalMs: config.timing.pollingIntervalMs,
      maxDeltaRatio: config.screenProbe.roiPixelDiffThreshold,
      signal
    });

    const responseStill = await this.screenProbe.waitForStability({
      roi: responseRoi,
      timeoutMs: 10_000,
      stableWindowMs: Math.max(1000, Math.floor(config.timing.roiStabilityWindowMs / 2)),
      pollIntervalMs: config.timing.pollingIntervalMs,
      maxDeltaRatio: config.screenProbe.roiPixelDiffThreshold,
      signal
    });

    const passedSignals = [stable, inputReady, responseStill].filter(Boolean).length;
    if (passedSignals < 2) {
      throw new Error(`Codex completion validation failed: ${passedSignals} signals`);
    }
  }

  async copyLatestReply(signal?: AbortSignal): Promise<string> {
    this.requireCopyCalibration();

    await this.focusVSCodeWindow(signal);
    await this.ensureCodexPaneActive(signal);
    await this.scrollToLatestResponse(signal);

    let nextCandidateIndex = 0;
    const primary = await this.runHoverCopyCycle(nextCandidateIndex, signal, 1);
    if (primary.text) {
      return primary.text;
    }

    nextCandidateIndex = primary.nextCandidateIndex;

    await this.ensureReplyAreaActiveIfNeeded(signal);
    await this.scrollToLatestResponse(signal);

    const remainingCopyAttempts = Math.max(1, this.getConfig().retries.maxCopyAttempts - 1);
    const fallback = await this.runHoverCopyCycle(nextCandidateIndex, signal, remainingCopyAttempts);
    if (fallback.text) {
      return fallback.text;
    }

    throw new StepError(
      STEP_CODES.CODEX_CLIPBOARD_NOT_CHANGED,
      "clipboard hash did not change after focus/activation/hover/copy fallback chain",
      {
        nextCandidateIndex: fallback.nextCandidateIndex
      }
    );
  }

  async debugPaneActivation(signal?: AbortSignal): Promise<void> {
    await this.focusVSCodeWindow(signal);
    await this.ensureCodexPaneActive(signal);
  }

  async debugHoverReveal(signal?: AbortSignal): Promise<void> {
    this.requireCopyCalibration();
    await this.focusVSCodeWindow(signal);
    await this.ensureCodexPaneActive(signal);
    const hoverPoints = this.resolveHoverPoints();
    if (!hoverPoints.length) {
      throw new StepError(
        STEP_CODES.CODEX_HOVER_REVEAL_FAILED,
        "no hover points configured"
      );
    }

    await this.hoverRevealCopyBar(hoverPoints[0], 1, signal);
  }

  async debugCopyOnly(signal?: AbortSignal): Promise<string> {
    return this.copyLatestReply(signal);
  }

  private async runHoverCopyCycle(
    startCandidateIndex: number,
    signal?: AbortSignal,
    maxCopyAttemptsOverride?: number
  ): Promise<HoverCopyResult> {
    const config = this.getConfig();
    const hoverPoints = this.resolveHoverPoints();
    const copyPoints = this.resolveCopyCandidatePoints();

    if (!hoverPoints.length) {
      throw new StepError(STEP_CODES.CODEX_HOVER_REVEAL_FAILED, "hover point list is empty");
    }

    if (!copyPoints.length) {
      throw new StepError(STEP_CODES.CODEX_COPY_CLICK_FAILED, "copy candidate points are empty");
    }

    const maxHoverAttempts = Math.max(1, config.retries.maxHoverAttempts);
    const maxCopyAttempts = Math.max(1, maxCopyAttemptsOverride ?? config.retries.maxCopyAttempts);
    let candidateIndex = startCandidateIndex;

    for (let hoverAttempt = 1; hoverAttempt <= maxHoverAttempts; hoverAttempt += 1) {
      if (candidateIndex - startCandidateIndex >= maxCopyAttempts) {
        break;
      }

      const hoverPoint = hoverPoints[(hoverAttempt - 1) % hoverPoints.length];
      await this.hoverRevealCopyBar(hoverPoint, hoverAttempt, signal);

      const copyPoint = copyPoints[candidateIndex % copyPoints.length];
      const copiedText = await this.clickCopyCandidateAndVerify(copyPoint, hoverAttempt, signal);
      candidateIndex += 1;

      if (copiedText) {
        return {
          text: copiedText,
          nextCandidateIndex: candidateIndex
        };
      }
    }

    return {
      text: null,
      nextCandidateIndex: candidateIndex
    };
  }

  private async focusVSCodeWindow(signal?: AbortSignal): Promise<void> {
    const config = this.getConfig();

    await this.windowManager.focusCodex(signal);
    const focused = await this.windowManager.verifyFrontmostApplication(config.windows.codexAppName, {
      attempts: config.retries.maxActivationAttempts,
      settleMs: config.timing.postActivationSettleMs,
      signal
    });

    if (!focused) {
      throw new StepError(
        STEP_CODES.VSCODE_WINDOW_FOCUS_FAILED,
        "failed to verify VSCode as frontmost app"
      );
    }
  }

  private async ensureCodexPaneActive(signal?: AbortSignal): Promise<void> {
    const config = this.getConfig();
    const point = config.calibration.codex.paneActivationPoint;

    if (!point) {
      throw new StepError(
        STEP_CODES.CODEX_PANE_ACTIVATION_FAILED,
        "paneActivationPoint is not calibrated"
      );
    }

    for (let attempt = 1; attempt <= Math.max(1, config.retries.maxActivationAttempts); attempt += 1) {
      await this.automation.leftClick(point, signal);
      await sleep(config.timing.postActivationSettleMs, signal);

      const focused = await this.windowManager.verifyFrontmostApplication(config.windows.codexAppName, {
        attempts: 1,
        settleMs: config.timing.postActivationSettleMs,
        signal
      });

      this.logger.info("Codex pane activation attempt", {
        attempt,
        point,
        focused
      });

      if (focused) {
        return;
      }
    }

    throw new StepError(
      STEP_CODES.CODEX_PANE_ACTIVATION_FAILED,
      "pane activation attempts exhausted",
      { point }
    );
  }

  private async ensureReplyAreaActiveIfNeeded(signal?: AbortSignal): Promise<void> {
    const config = this.getConfig();
    const point = config.calibration.codex.replyAreaActivationPoint;

    if (!point) {
      throw new StepError(
        STEP_CODES.CODEX_REPLY_AREA_ACTIVATION_FAILED,
        "replyAreaActivationPoint is not calibrated"
      );
    }

    for (let attempt = 1; attempt <= Math.max(1, config.retries.maxActivationAttempts); attempt += 1) {
      await this.automation.leftClick(point, signal);
      await sleep(config.timing.postActivationSettleMs, signal);

      const focused = await this.windowManager.verifyFrontmostApplication(config.windows.codexAppName, {
        attempts: 1,
        settleMs: config.timing.postActivationSettleMs,
        signal
      });

      this.logger.info("Codex reply area activation attempt", {
        attempt,
        point,
        focused
      });

      if (focused) {
        return;
      }
    }

    throw new StepError(
      STEP_CODES.CODEX_REPLY_AREA_ACTIVATION_FAILED,
      "reply area activation attempts exhausted",
      { point }
    );
  }

  private async scrollToLatestResponse(signal?: AbortSignal): Promise<void> {
    const config = this.getConfig();
    const anchors = config.calibration.codex;

    try {
      await this.automation.scrollToBottom(signal);
      if (anchors.bottomAnchor) {
        await this.automation.leftClick(anchors.bottomAnchor, signal);
      }

      await sleep(config.timing.postScrollSettleMs, signal);

      if (anchors.bottomDetectionRoi) {
        const stable = await this.screenProbe.waitForStability({
          roi: anchors.bottomDetectionRoi,
          timeoutMs: Math.min(10_000, config.timeout.copyMs),
          stableWindowMs: Math.max(250, Math.floor(config.timing.postScrollSettleMs / 2)),
          pollIntervalMs: config.timing.pollingIntervalMs,
          maxDeltaRatio: config.screenProbe.roiPixelDiffThreshold,
          signal
        });

        if (!stable) {
          throw new Error("bottom ROI did not stabilize after scroll");
        }
      }
    } catch (error) {
      throw new StepError(
        STEP_CODES.CODEX_SCROLL_BOTTOM_FAILED,
        "failed to scroll to latest response",
        { error: String(error) }
      );
    }
  }

  private async hoverRevealCopyBar(point: Point, attempt: number, signal?: AbortSignal): Promise<void> {
    const config = this.getConfig();

    try {
      const focused = await this.windowManager.verifyFrontmostApplication(config.windows.codexAppName, {
        attempts: 1,
        settleMs: config.timing.postActivationSettleMs,
        signal
      });

      if (!focused) {
        await this.focusVSCodeWindow(signal);
        await this.ensureCodexPaneActive(signal);
      }

      await this.automation.hover(point, config.timing.hoverDwellMs, signal);
      await sleep(config.timing.postHoverSettleMs, signal);

      this.logger.info("Codex hover reveal", {
        attempt,
        point
      });
    } catch (error) {
      throw new StepError(
        STEP_CODES.CODEX_HOVER_REVEAL_FAILED,
        "hover reveal failed",
        {
          attempt,
          point,
          error: String(error)
        }
      );
    }
  }

  private async clickCopyCandidateAndVerify(
    point: Point,
    attempt: number,
    signal?: AbortSignal
  ): Promise<string | null> {
    const config = this.getConfig();
    const beforeHash = this.clipboard.getHash();

    try {
      await this.automation.leftClick(point, signal);
    } catch (error) {
      throw new StepError(
        STEP_CODES.CODEX_COPY_CLICK_FAILED,
        "copy candidate click failed",
        {
          point,
          attempt,
          error: String(error)
        }
      );
    }

    const result = await this.clipboard.waitForHashChangeWithin(beforeHash, {
      timeoutMs: config.timing.clipboardVerifyTimeoutMs,
      pollIntervalMs: config.timing.pollingIntervalMs,
      requireNonEmpty: true,
      signal
    });

    if (!result.changed || !result.text.trim()) {
      this.logger.warn(STEP_CODES.CODEX_CLIPBOARD_NOT_CHANGED, {
        attempt,
        point,
        beforeHash,
        afterHash: result.hash
      });
      return null;
    }

    this.logger.info("Codex copy succeeded", {
      attempt,
      point,
      length: result.text.length
    });

    return result.text;
  }

  private resolveResponseRoi(): Rect | null {
    const codex = this.getConfig().calibration.codex;
    return codex.stableRoi ?? codex.responseRoi;
  }

  private resolveHoverPoints(): Point[] {
    const codex = this.getConfig().calibration.codex;
    if (!codex.hoverBandAnchor) {
      return [];
    }

    return codex.hoverOffsets.map((offset) => addPoint(codex.hoverBandAnchor as Point, offset));
  }

  private resolveCopyCandidatePoints(): Point[] {
    const points = this.getConfig().calibration.codex.copyCandidatePoints;
    return points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  }

  private requireCopyCalibration(): void {
    const codex = this.getConfig().calibration.codex;
    const responseRoi = this.resolveResponseRoi();

    if (
      !codex.inputAnchor ||
      !codex.paneActivationPoint ||
      !codex.replyAreaActivationPoint ||
      !codex.hoverBandAnchor ||
      codex.copyCandidatePoints.length === 0 ||
      !responseRoi ||
      (!codex.bottomAnchor && !codex.bottomDetectionRoi)
    ) {
      throw new Error("Codex calibration is incomplete for focus-before-hover copy stage");
    }
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
