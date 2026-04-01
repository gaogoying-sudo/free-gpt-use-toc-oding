import { app, dialog } from "electron";
import { ChatGPTAdapter } from "../adapters/chatgpt/chatgpt-adapter";
import { CodexAdapter } from "../adapters/codex/codex-adapter";
import { CalibrationService, CalibrationTarget } from "../calibration/calibration-service";
import { ConfigStore } from "../config/config-store";
import { BridgeConfig } from "../types/config";
import { getStepCode } from "../types/step-codes";
import { BridgeState } from "../types/state";
import { HotkeyManager } from "../hotkeys/hotkey-manager";
import { TrayManager } from "../menubar/tray-manager";
import { BridgeOrchestrator } from "../orchestration/bridge-orchestrator";
import { AutomationService } from "../services/automation/automation-service";
import { ClipboardService } from "../services/clipboard/clipboard-service";
import { Logger } from "../services/logger/logger";
import { ScreenProbeService } from "../services/screen-probe/screen-probe-service";
import { WindowManagerService } from "../services/window-manager/window-manager-service";

export type RuntimeMode = "app" | "diag";

export interface RuntimeBootstrapOptions {
  mode?: RuntimeMode;
}

export class BridgeRuntime {
  private config!: BridgeConfig;
  private configStore!: ConfigStore;
  private logger!: Logger;
  private calibration!: CalibrationService;

  private hotkeys: HotkeyManager | null = null;
  private tray: TrayManager | null = null;
  private orchestrator!: BridgeOrchestrator;

  private automation!: AutomationService;
  private clipboard!: ClipboardService;
  private screenProbe!: ScreenProbeService;
  private windowManager!: WindowManagerService;
  private chatgpt!: ChatGPTAdapter;
  private codex!: CodexAdapter;

  private readonly mode: RuntimeMode;

  private constructor(mode: RuntimeMode) {
    this.mode = mode;
  }

  static async bootstrap(options: RuntimeBootstrapOptions = {}): Promise<BridgeRuntime> {
    const runtime = new BridgeRuntime(options.mode ?? "app");
    await runtime.initialize();
    return runtime;
  }

  private async initialize(): Promise<void> {
    this.configStore = new ConfigStore(app.getPath("userData"));
    this.config = await this.configStore.load();
    this.logger = new Logger(this.configStore.getLogsDir(), this.config.debug.enabled);
    this.calibration = new CalibrationService(this.logger);

    const getConfig = () => this.config;
    this.automation = new AutomationService(getConfig, this.logger);
    this.clipboard = new ClipboardService(this.logger);
    this.screenProbe = new ScreenProbeService(getConfig, this.logger);
    this.windowManager = new WindowManagerService(getConfig, this.automation, this.logger);

    this.chatgpt = new ChatGPTAdapter(
      getConfig,
      this.windowManager,
      this.automation,
      this.clipboard,
      this.screenProbe,
      this.logger
    );

    this.codex = new CodexAdapter(
      getConfig,
      this.windowManager,
      this.automation,
      this.clipboard,
      this.screenProbe,
      this.logger
    );

    this.orchestrator = new BridgeOrchestrator(
      getConfig,
      this.chatgpt,
      this.codex,
      this.clipboard,
      this.logger
    );

    if (this.mode === "app") {
      this.initializeAppShell();
    }

    const status = this.calibration.getStatus(this.config);
    this.logger.info("calibration status on startup", status);

    if (this.mode === "app" && !this.calibration.isCalibrated(this.config)) {
      this.logger.warn("calibration missing on startup");
      await this.recalibrate("all");
    }

    this.logger.info("runtime initialized", {
      mode: this.mode,
      configPath: this.configStore.getConfigPath(),
      state: this.orchestrator.getState()
    });
  }

  private initializeAppShell(): void {
    this.hotkeys = new HotkeyManager(this.logger);
    this.tray = new TrayManager(
      {
        onStartResume: () => {
          void this.startResume(false, "menu");
        },
        onStop: () => {
          void this.stop("menu stop");
        },
        onSingleRound: () => {
          void this.startResume(true, "menu single round");
        },
        onRecalibrate: () => {
          void this.recalibrate("all");
        },
        onRecalibrateRight: () => {
          void this.recalibrate("right");
        },
        onPrintCalibrationStatus: () => {
          this.printCalibrationAndThresholds(true);
        }
      },
      {
        configPath: this.configStore.getConfigPath(),
        logsPath: this.logger.getLogFilePath()
      }
    );

    this.orchestrator.on("stateChanged", (event) => {
      this.tray?.updateState(event.to);
    });

    this.orchestrator.on("roundCompleted", (round) => {
      this.logger.info("round completed event", { round });
    });

    this.registerHotkeys();
  }

  async dispose(): Promise<void> {
    await this.stop("app exit");
    this.hotkeys?.unregister();
    this.tray?.destroy();
  }

  async runDiagnostic(command: string, args: string[]): Promise<number> {
    this.logger.info("diag command start", { command, args });

    try {
      switch (command) {
        case "print-calibration":
          this.printCalibrationAndThresholds(true);
          break;
        case "check-permissions":
          await this.runPermissionChecks();
          break;
        case "left-send": {
          const text = args.join(" ").trim() || "[diag] left-send";
          await this.chatgpt.debugSendOnly(text);
          break;
        }
        case "left-copy": {
          const text = await this.chatgpt.debugCopyOnly();
          console.log(`[diag] left-copy length=${text.length}`);
          break;
        }
        case "right-activate-body":
          await this.codex.debugActivateBody();
          break;
        case "right-select-all":
          await this.codex.debugSelectAll();
          break;
        case "right-copy-full-transcript": {
          const text = await this.codex.debugCopyFullTranscript();
          console.log(`[diag] right-copy-full-transcript length=${text.length}`);
          break;
        }
        case "right-extract-latest": {
          const promptOverride = args.join(" ").trim() || undefined;
          const result = await this.codex.debugExtractLatest(promptOverride);
          console.log(
            `[diag] right-extract-latest strategy=${result.strategy} transcriptLength=${result.transcriptLength} replyLength=${result.reply.length}`
          );
          break;
        }
        case "round-gpt-to-codex":
          await this.runSingleDirectionRound("gpt-to-codex");
          break;
        case "round-codex-to-gpt":
          await this.runSingleDirectionRound("codex-to-gpt");
          break;
        case "help":
        default:
          this.printDiagnosticHelp();
          break;
      }

      this.logger.info("diag command completed", { command });
      return 0;
    } catch (error) {
      const code = getStepCode(error);
      this.logger.error("diag command failed", {
        command,
        error: String(error),
        stepCode: code
      });
      console.error(`[diag] failed command=${command} stepCode=${code ?? "N/A"}`, error);
      return 1;
    }
  }

  private registerHotkeys(): void {
    this.hotkeys?.register(this.config, {
      onStartResume: () => {
        void this.startResume(false, "hotkey");
      },
      onStop: () => {
        void this.stop("hotkey stop");
      },
      onRecalibrate: () => {
        void this.recalibrate("all");
      }
    });
  }

  private async startResume(singleRound: boolean, source: string): Promise<void> {
    if (!this.calibration.isCalibrated(this.config)) {
      const status = this.calibration.getStatus(this.config);
      const result = await dialog.showMessageBox({
        type: "warning",
        title: "需要先校准",
        message: "当前尚未完成校准，是否现在开始全量校准？",
        detail: this.statusToDetail(status),
        buttons: ["开始校准", "取消"],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      });

      if (result.response === 0) {
        await this.recalibrate("all");
      }

      return;
    }

    if (this.orchestrator.getState() === BridgeState.ERROR) {
      this.logger.warn("resume requested from ERROR state; resetting to IDLE by stop");
      await this.stop("recover from error");
    }

    this.logger.info("starting orchestrator", {
      singleRound,
      source
    });

    void this.orchestrator.start({ singleRound });
  }

  private async stop(reason: string): Promise<void> {
    this.logger.info("stop requested", { reason });
    await this.orchestrator.stop(reason);
  }

  private async recalibrate(target: CalibrationTarget): Promise<void> {
    this.logger.info("recalibration started", { target });

    if (
      this.orchestrator.getState() !== BridgeState.IDLE &&
      this.orchestrator.getState() !== BridgeState.STOPPED &&
      this.orchestrator.getState() !== BridgeState.ERROR
    ) {
      await this.stop("recalibration requested");
    }

    const next = await this.calibration.run(this.config, target);
    if (!next) {
      return;
    }

    this.config = next;
    await this.configStore.save(this.config);
    this.registerHotkeys();
    this.tray?.updateState(BridgeState.IDLE);

    const status = this.calibration.getStatus(this.config);
    this.logger.info("recalibration completed", status);
  }

  private printCalibrationAndThresholds(printToConsole = false): void {
    const status = this.calibration.getStatus(this.config);

    const payload = {
      status,
      left: this.config.calibration.chatgpt,
      right: {
        calibration: this.config.calibration.codex,
        flow: this.config.codex
      },
      tuning: {
        timing: this.config.timing,
        retries: this.config.retries,
        screenProbe: this.config.screenProbe
      }
    };

    this.logger.info("diagnostic calibration dump", payload);
    if (printToConsole) {
      console.log("[diag] calibration+thresholds");
      console.log(JSON.stringify(payload, null, 2));
    }
  }

  private async runPermissionChecks(): Promise<void> {
    const report: Record<string, unknown> = {
      accessibility: false,
      clipboardReadWrite: false,
      frontSwitchChatGPT: false,
      frontSwitchCodex: false
    };

    try {
      await this.automation.pressEscape();
      report.accessibility = true;
    } catch (error) {
      report.accessibility = false;
      report.accessibilityError = String(error);
    }

    try {
      const backup = this.clipboard.getText();
      const token = `[diag-${Date.now()}]`;
      this.clipboard.setText(token);
      report.clipboardReadWrite = this.clipboard.getText() === token;
      this.clipboard.setText(backup);
    } catch (error) {
      report.clipboardReadWrite = false;
      report.clipboardError = String(error);
    }

    try {
      await this.windowManager.focusChatGPT();
      report.frontSwitchChatGPT = await this.windowManager.verifyFrontmostApplication(
        this.config.windows.chatgptAppName,
        {
          attempts: 2,
          settleMs: this.config.timing.postActivationSettleMs
        }
      );
    } catch (error) {
      report.frontSwitchChatGPT = false;
      report.frontSwitchChatGPTError = String(error);
    }

    try {
      await this.windowManager.focusCodex();
      report.frontSwitchCodex = await this.windowManager.verifyFrontmostApplication(
        this.config.windows.codexAppName,
        {
          attempts: 2,
          settleMs: this.config.timing.postActivationSettleMs
        }
      );
    } catch (error) {
      report.frontSwitchCodex = false;
      report.frontSwitchCodexError = String(error);
    }

    this.logger.info("permission/self-check report", report);
    console.log("[diag] permission/self-check");
    console.log(JSON.stringify(report, null, 2));
  }

  private async runSingleDirectionRound(direction: "gpt-to-codex" | "codex-to-gpt"): Promise<void> {
    if (direction === "gpt-to-codex") {
      await this.chatgpt.waitForLatestResponseComplete();
      const payload = await this.chatgpt.copyLatestReply();
      await this.codex.sendMessage(payload);
      this.logger.info("single direction round finished", {
        direction,
        length: payload.length
      });
      return;
    }

    await this.codex.waitForLatestResponseComplete();
    const payload = await this.codex.copyLatestReply();
    await this.chatgpt.sendMessage(payload);
    this.logger.info("single direction round finished", {
      direction,
      length: payload.length
    });
  }

  private printDiagnosticHelp(): void {
    const lines = [
      "[diag] available commands:",
      "  print-calibration",
      "  check-permissions",
      "  left-send <text>",
      "  left-copy",
      "  right-activate-body",
      "  right-select-all",
      "  right-copy-full-transcript",
      "  right-extract-latest [prompt-override]",
      "  round-gpt-to-codex",
      "  round-codex-to-gpt"
    ];

    for (const line of lines) {
      console.log(line);
    }
  }

  private statusToDetail(status: ReturnType<CalibrationService["getStatus"]>): string {
    const leftMissing = status.missingLeft.length
      ? `Left missing: ${status.missingLeft.join(", ")}`
      : "Left missing: none";
    const rightMissing = status.missingRight.length
      ? `Right missing: ${status.missingRight.join(", ")}`
      : "Right missing: none";
    return `${leftMissing}\n${rightMissing}`;
  }
}
