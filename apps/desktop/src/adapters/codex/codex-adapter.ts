import { parseLatestCodexReply } from "./codex-transcript-parser";
import { ConversationAdapter } from "../conversation-adapter";
import { BridgeConfig } from "../../types/config";
import { Rect, Point, clampRect } from "../../types/geometry";
import { STEP_CODES, StepError } from "../../types/step-codes";
import { ClipboardService } from "../../services/clipboard/clipboard-service";
import { Logger } from "../../services/logger/logger";
import { ScreenProbeService } from "../../services/screen-probe/screen-probe-service";
import { WindowManagerService } from "../../services/window-manager/window-manager-service";
import { AutomationService } from "../../services/automation/automation-service";
import { sleep } from "../../services/utils";

export class CodexAdapter implements ConversationAdapter {
  private lastSentToCodexRaw: string | null = null;
  private lastForwardedCodexReplyHash: string | null = null;

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
    const inputAnchor = config.calibration.codex.inputAnchor;

    if (!inputAnchor) {
      throw new Error("Codex calibration is incomplete: missing inputAnchor");
    }

    await this.focusVSCodeWindow(signal);
    await this.ensureCodexPaneActive(signal);

    await this.automation.leftClick(inputAnchor, signal);
    this.clipboard.setText(text);
    await this.automation.paste(signal);

    const hasInput = await this.probeInputHasContent(signal);
    if (!hasInput) {
      throw new Error("Codex input validation failed: pasted content is empty");
    }

    await this.automation.pressEnter(signal);
    await sleep(config.timing.actionDelayMs, signal);

    const responseRoi = await this.resolveResponseRoi(signal);
    const inputRoi = await this.resolveFollowUpInputRoi(signal);

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
      minRequired: config.calibration.codex.minSendSignals
    });

    if (passedSignals < config.calibration.codex.minSendSignals) {
      throw new Error(`Codex send validation failed: only ${passedSignals} signals`);
    }

    this.lastSentToCodexRaw = text;
  }

  async waitForLatestResponseComplete(signal?: AbortSignal): Promise<void> {
    const config = this.getConfig();
    const responseRoi = await this.resolveResponseRoi(signal);
    const inputRoi = await this.resolveFollowUpInputRoi(signal);

    await this.focusVSCodeWindow(signal);
    await this.ensureCodexPaneActive(signal);

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
      roi: inputRoi,
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
    await this.focusVSCodeWindow(signal);
    await this.ensureCodexPaneActive(signal);
    await this.scrollToLatestResponse(signal);

    const transcript = await this.copyFullTranscriptWithRetries(signal);
    const parsed = this.parseLatestReply(transcript);
    this.lastForwardedCodexReplyHash = this.clipboard.getHash(parsed.reply);
    return parsed.reply;
  }

  async debugActivateBody(signal?: AbortSignal): Promise<void> {
    await this.focusVSCodeWindow(signal);
    await this.ensureCodexPaneActive(signal);
    await this.exitInputFocus(signal);
    await this.activateResponseBody(signal);
  }

  async debugSelectAll(signal?: AbortSignal): Promise<void> {
    await this.debugActivateBody(signal);
    await this.selectAllInTranscript(signal);
  }

  async debugCopyFullTranscript(signal?: AbortSignal): Promise<string> {
    await this.focusVSCodeWindow(signal);
    await this.ensureCodexPaneActive(signal);
    await this.scrollToLatestResponse(signal);
    return this.copyFullTranscriptWithRetries(signal);
  }

  async debugExtractLatest(promptOverride?: string, signal?: AbortSignal): Promise<{
    reply: string;
    strategy: string;
    transcriptLength: number;
  }> {
    const prompt = promptOverride?.trim();
    if (prompt) {
      this.lastSentToCodexRaw = prompt;
    }

    const transcript = await this.debugCopyFullTranscript(signal);
    const parsed = this.parseLatestReply(transcript);

    return {
      reply: parsed.reply,
      strategy: parsed.strategy,
      transcriptLength: parsed.transcriptLength
    };
  }

  private async copyFullTranscriptWithRetries(signal?: AbortSignal): Promise<string> {
    const config = this.getConfig();
    const attempts = Math.max(1, config.retries.maxCopyAttempts);

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await this.exitInputFocus(signal);
        await this.activateResponseBody(signal);
        return await this.copyFullTranscriptOnce(attempt, signal);
      } catch (error) {
        this.logger.warn("Codex full transcript copy attempt failed", {
          attempt,
          attempts,
          error: String(error),
          stepCode: error instanceof StepError ? error.code : null
        });

        if (attempt === attempts) {
          throw error;
        }

        await this.scrollToLatestResponse(signal);
      }
    }

    throw new StepError(
      STEP_CODES.CODEX_COPY_FULL_TRANSCRIPT_FAILED,
      "copy attempts exhausted without transcript"
    );
  }

  private async copyFullTranscriptOnce(attempt: number, signal?: AbortSignal): Promise<string> {
    const config = this.getConfig();
    const beforeHash = this.seedClipboardProbe();

    await this.selectAllInTranscript(signal);

    try {
      await this.automation.copy(signal);
    } catch (error) {
      throw new StepError(
        STEP_CODES.CODEX_COPY_FULL_TRANSCRIPT_FAILED,
        "command+c failed while copying full transcript",
        {
          attempt,
          error: String(error)
        }
      );
    }

    const result = await this.clipboard.waitForHashChangeWithin(beforeHash, {
      timeoutMs: config.timing.clipboardVerifyTimeoutMs,
      pollIntervalMs: config.timing.pollingIntervalMs,
      requireNonEmpty: false,
      signal
    });

    if (!result.changed) {
      throw new StepError(
        STEP_CODES.CODEX_COPY_FULL_TRANSCRIPT_FAILED,
        "clipboard hash did not change after full transcript copy",
        {
          attempt
        }
      );
    }

    if (!result.text.trim()) {
      throw new StepError(
        STEP_CODES.CODEX_CLIPBOARD_EMPTY,
        "clipboard is empty after full transcript copy",
        {
          attempt
        }
      );
    }

    this.logger.info("Codex full transcript copied", {
      attempt,
      length: result.text.length
    });

    return result.text;
  }

  private parseLatestReply(transcript: string): {
    reply: string;
    strategy: string;
    transcriptLength: number;
  } {
    try {
      const config = this.getConfig();
      const parsed = parseLatestCodexReply({
        transcript,
        lastSentToCodexRaw: this.lastSentToCodexRaw,
        previousForwardedReplyHash: this.lastForwardedCodexReplyHash,
        promptFingerprintChars: config.codex.promptFingerprintChars,
        maxTranscriptChars: config.codex.maxTranscriptChars,
        minExtractedReplyLength: config.codex.minExtractedReplyLength,
        getHash: (value) => this.clipboard.getHash(value)
      });

      this.logger.info("Codex transcript extracted latest reply", {
        strategy: parsed.strategy,
        transcriptLength: parsed.transcriptLength,
        replyLength: parsed.reply.length
      });

      return parsed;
    } catch (error) {
      if (error instanceof StepError) {
        throw error;
      }

      throw new StepError(
        STEP_CODES.CODEX_TRANSCRIPT_PARSE_FAILED,
        "unexpected error while parsing latest codex reply",
        {
          error: String(error)
        }
      );
    }
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

    for (let attempt = 1; attempt <= Math.max(1, config.retries.maxActivationAttempts); attempt += 1) {
      const point = await this.resolveBodyActivationPoint(signal);
      await this.automation.leftClick(point, signal);
      await sleep(config.timing.postActivationSettleMs, signal);

      const frontmost = await this.windowManager.verifyFrontmostApplication(config.windows.codexAppName, {
        attempts: 1,
        settleMs: config.timing.postActivationSettleMs,
        signal
      });

      if (frontmost) {
        this.logger.info("Codex pane activation succeeded", { attempt, point });
        return;
      }
    }

    throw new StepError(
      STEP_CODES.CODEX_BODY_ACTIVATION_FAILED,
      "failed to activate Codex pane before transcript selection"
    );
  }

  private async scrollToLatestResponse(signal?: AbortSignal): Promise<void> {
    const config = this.getConfig();

    try {
      await this.automation.scrollToBottom(signal);
      await sleep(config.timing.postScrollSettleMs, signal);

      const responseRoi = await this.resolveResponseRoi(signal);
      const stable = await this.screenProbe.waitForStability({
        roi: responseRoi,
        timeoutMs: Math.min(10_000, config.timeout.copyMs),
        stableWindowMs: Math.max(300, Math.floor(config.timing.postScrollSettleMs / 2)),
        pollIntervalMs: config.timing.pollingIntervalMs,
        maxDeltaRatio: config.screenProbe.roiPixelDiffThreshold,
        signal
      });

      if (!stable) {
        throw new Error("response ROI did not stabilize after scroll");
      }
    } catch (error) {
      throw new StepError(
        STEP_CODES.CODEX_SCROLL_BOTTOM_FAILED,
        "failed to scroll to latest Codex response",
        {
          error: String(error)
        }
      );
    }
  }

  private async exitInputFocus(signal?: AbortSignal): Promise<void> {
    await this.automation.pressEscape(signal);
    await sleep(Math.max(60, Math.floor(this.getConfig().timing.actionDelayMs / 2)), signal);
  }

  private async activateResponseBody(signal?: AbortSignal): Promise<Point> {
    const config = this.getConfig();
    const point = await this.resolveBodyActivationPoint(signal);

    try {
      await this.automation.leftClick(point, signal);
      await sleep(config.timing.postActivationSettleMs, signal);
      this.logger.info("Codex response body activated", { point });
      return point;
    } catch (error) {
      throw new StepError(
        STEP_CODES.CODEX_BODY_ACTIVATION_FAILED,
        "failed to activate Codex response body",
        {
          point,
          error: String(error)
        }
      );
    }
  }

  private async selectAllInTranscript(signal?: AbortSignal): Promise<void> {
    try {
      await this.automation.selectAll(signal);
      await sleep(Math.max(60, Math.floor(this.getConfig().timing.actionDelayMs / 2)), signal);
    } catch (error) {
      throw new StepError(STEP_CODES.CODEX_SELECT_ALL_FAILED, "command+a failed", {
        error: String(error)
      });
    }
  }

  private seedClipboardProbe(): string {
    const token = `[bridge-codex-transcript-${Date.now()}-${Math.random().toString(16).slice(2)}]`;
    this.clipboard.setText(token);
    return this.clipboard.getHash(token);
  }

  private async resolveBodyActivationPoint(signal?: AbortSignal): Promise<Point> {
    const bounds = await this.resolveCodexWindowBounds(signal);
    const ratio = this.getConfig().codex.responseBodyActivationRatio;

    return {
      x: Math.round(bounds.x + bounds.width * ratio.x),
      y: Math.round(bounds.y + bounds.height * ratio.y)
    };
  }

  private async resolveResponseRoi(signal?: AbortSignal): Promise<Rect> {
    const codexCalibration = this.getConfig().calibration.codex;
    if (codexCalibration.stableRoi) {
      return clampRect(codexCalibration.stableRoi);
    }

    const bounds = await this.resolveCodexWindowBounds(signal);
    const ratio = this.getConfig().codex.responseBodyRoiRatio;
    return clampRect({
      x: Math.round(bounds.x + bounds.width * ratio.x),
      y: Math.round(bounds.y + bounds.height * ratio.y),
      width: Math.round(bounds.width * ratio.width),
      height: Math.round(bounds.height * ratio.height)
    });
  }

  private async resolveFollowUpInputRoi(signal?: AbortSignal): Promise<Rect> {
    const inputAnchor = this.getConfig().calibration.codex.inputAnchor;
    if (inputAnchor) {
      return this.rectAroundPoint(inputAnchor, 560, 72);
    }

    const bounds = await this.resolveCodexWindowBounds(signal);
    const ratio = this.getConfig().codex.followUpInputRoiRatio;
    return clampRect({
      x: Math.round(bounds.x + bounds.width * ratio.x),
      y: Math.round(bounds.y + bounds.height * ratio.y),
      width: Math.round(bounds.width * ratio.width),
      height: Math.round(bounds.height * ratio.height)
    });
  }

  private async resolveCodexWindowBounds(signal?: AbortSignal): Promise<Rect> {
    const config = this.getConfig();
    const bounds = await this.windowManager.getFrontWindowBounds(config.windows.codexAppName);

    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      throw new StepError(
        STEP_CODES.CODEX_BODY_ACTIVATION_FAILED,
        "cannot resolve VSCode front window bounds for Codex activation",
        {
          bounds
        }
      );
    }

    if (signal?.aborted) {
      throw new Error("Aborted");
    }

    return bounds;
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

  private rectAroundPoint(point: Point, width: number, height: number): Rect {
    return {
      x: Math.round(point.x - width / 2),
      y: Math.round(point.y - height / 2),
      width,
      height
    };
  }
}
