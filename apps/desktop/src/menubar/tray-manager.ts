import { Menu, Tray, app, nativeImage, shell } from "electron";
import { BridgeState } from "../types/state";

export interface TrayHandlers {
  onStartResume: () => void;
  onStop: () => void;
  onSingleRound: () => void;
  onRecalibrate: () => void;
}

interface TrayOptions {
  configPath: string;
  logsPath: string;
}

export class TrayManager {
  private readonly tray: Tray;
  private state: BridgeState = BridgeState.IDLE;

  constructor(private readonly handlers: TrayHandlers, private readonly options: TrayOptions) {
    const icon = nativeImage.createFromNamedImage("NSActionTemplate", [16, 16]);
    this.tray = new Tray(icon);
    this.tray.setToolTip("Mac GPT ↔ Codex Bridge V0");
    this.updateState(BridgeState.IDLE);
  }

  updateState(state: BridgeState): void {
    this.state = state;
    this.tray.setTitle(`Bridge ${state}`);
    this.tray.setContextMenu(this.buildMenu());
  }

  destroy(): void {
    this.tray.destroy();
  }

  private buildMenu(): Menu {
    return Menu.buildFromTemplate([
      {
        label: `State: ${this.state}`,
        enabled: false
      },
      {
        type: "separator"
      },
      {
        label: "Start / Resume",
        click: this.handlers.onStartResume
      },
      {
        label: "Stop",
        click: this.handlers.onStop
      },
      {
        label: "Run Single Round",
        click: this.handlers.onSingleRound
      },
      {
        label: "Recalibrate",
        click: this.handlers.onRecalibrate
      },
      {
        type: "separator"
      },
      {
        label: "Show Config",
        click: () => {
          void shell.showItemInFolder(this.options.configPath);
        }
      },
      {
        label: "Show Logs",
        click: () => {
          void shell.showItemInFolder(this.options.logsPath);
        }
      },
      {
        type: "separator"
      },
      {
        label: "Quit",
        click: () => {
          app.quit();
        }
      }
    ]);
  }
}
