import { app, dialog } from "electron";
import { ChatGPTAdapter } from "../adapters/chatgpt/chatgpt-adapter";
import { CodexAdapter } from "../adapters/codex/codex-adapter";
import { CalibrationService } from "../calibration/calibration-service";
import { ConfigStore } from "../config/config-store";
import { BridgeConfig } from "../types/config";
import { BridgeState } from "../types/state";
import { HotkeyManager } from "../hotkeys/hotkey-manager";
import { TrayManager } from "../menubar/tray-manager";
import { BridgeOrchestrator } from "../orchestration/bridge-orchestrator";
import { AutomationService } from "../services/automation/automation-service";
import { ClipboardService } from "../services/clipboard/clipboard-service";
import { Logger } from "../services/logger/logger";
import { ScreenProbeService } from "../services/screen-probe/screen-probe-service";
import { WindowManagerService } from "../services/window-manager/window-manager-service";

export class BridgeRuntime {
  private config!: BridgeConfig;
  private configStore!: ConfigStore;
  private logger!: Logger;
  private calibration!: CalibrationService;

  private hotkeys!: HotkeyManager;
  private tray!: TrayManager;
  private orchestrator!: BridgeOrchestrator;

  static async bootstrap(): Promise<BridgeRuntime> {
    const runtime = new BridgeRuntime();
    await runtime.initialize();
    return runtime;
  }

  private async initialize(): Promise<void> {
    this.configStore = new ConfigStore(app.getPath("userData"));
    this.config = await this.configStore.load();
    this.logger = new Logger(this.configStore.getLogsDir(), this.config.debug.enabled);
    this.calibration = new CalibrationService(this.logger);

    const getConfig = () => this.config;
    const automation = new AutomationService(getConfig, this.logger);
    const clipboard = new ClipboardService(this.logger);
    const screenProbe = new ScreenProbeService(getConfig, this.logger);
    const windowManager = new WindowManagerService(getConfig, automation, this.logger);

    const chatgpt = new ChatGPTAdapter(
      getConfig,
      windowManager,
      automation,
      clipboard,
      screenProbe,
      this.logger
    );

    const codex = new CodexAdapter(
      getConfig,
      windowManager,
      automation,
      clipboard,
      screenProbe,
      this.logger
    );

    this.orchestrator = new BridgeOrchestrator(
      getConfig,
      chatgpt,
      codex,
      clipboard,
      this.logger
    );

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
          void this.recalibrate();
        }
      },
      {
        configPath: this.configStore.getConfigPath(),
        logsPath: this.logger.getLogFilePath()
      }
    );

    this.orchestrator.on("stateChanged", (event) => {
      this.tray.updateState(event.to);
    });

    this.orchestrator.on("roundCompleted", (round) => {
      this.logger.info("round completed event", { round });
    });

    this.registerHotkeys();

    if (!this.calibration.isCalibrated(this.config)) {
      this.logger.warn("calibration missing on startup");
      await this.recalibrate();
    }

    this.logger.info("runtime initialized", {
      configPath: this.configStore.getConfigPath(),
      state: this.orchestrator.getState()
    });
  }

  async dispose(): Promise<void> {
    await this.stop("app exit");
    this.hotkeys.unregister();
    this.tray.destroy();
  }

  private registerHotkeys(): void {
    this.hotkeys.register(this.config, {
      onStartResume: () => {
        void this.startResume(false, "hotkey");
      },
      onStop: () => {
        void this.stop("hotkey stop");
      },
      onRecalibrate: () => {
        void this.recalibrate();
      }
    });
  }

  private async startResume(singleRound: boolean, source: string): Promise<void> {
    if (!this.calibration.isCalibrated(this.config)) {
      const result = await dialog.showMessageBox({
        type: "warning",
        title: "需要先校准",
        message: "当前尚未完成校准，是否现在开始校准？",
        buttons: ["开始校准", "取消"],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      });

      if (result.response === 0) {
        await this.recalibrate();
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

  private async recalibrate(): Promise<void> {
    this.logger.info("recalibration started");

    if (
      this.orchestrator.getState() !== BridgeState.IDLE &&
      this.orchestrator.getState() !== BridgeState.STOPPED &&
      this.orchestrator.getState() !== BridgeState.ERROR
    ) {
      await this.stop("recalibration requested");
    }

    const next = await this.calibration.run(this.config);
    if (!next) {
      return;
    }

    this.config = next;
    await this.configStore.save(this.config);
    this.registerHotkeys();
    this.tray.updateState(BridgeState.IDLE);

    this.logger.info("recalibration completed", {
      calibrated: this.config.calibration.calibrated
    });
  }
}
