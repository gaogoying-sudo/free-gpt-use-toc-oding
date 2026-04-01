import { globalShortcut } from "electron";
import { BridgeConfig } from "../types/config";
import { Logger } from "../services/logger/logger";

export interface HotkeyHandlers {
  onStartResume: () => void;
  onStop: () => void;
  onRecalibrate: () => void;
}

export class HotkeyManager {
  private registered = false;

  constructor(private readonly logger: Logger) {}

  register(config: BridgeConfig, handlers: HotkeyHandlers): void {
    this.unregister();

    this.registerShortcut(config.hotkeys.startResume, handlers.onStartResume, "startResume");
    this.registerShortcut(config.hotkeys.stop, handlers.onStop, "stop");
    this.registerShortcut(config.hotkeys.recalibrate, handlers.onRecalibrate, "recalibrate");

    this.registered = true;
  }

  unregister(): void {
    if (!this.registered) {
      return;
    }

    globalShortcut.unregisterAll();
    this.registered = false;
    this.logger.info("global hotkeys unregistered");
  }

  private registerShortcut(acceleratorRaw: string, handler: () => void, key: string): void {
    const accelerator = this.normalizeAccelerator(acceleratorRaw);
    const ok = globalShortcut.register(accelerator, handler);

    if (!ok) {
      this.logger.error("failed to register hotkey", {
        key,
        acceleratorRaw,
        accelerator
      });
      return;
    }

    this.logger.info("hotkey registered", {
      key,
      acceleratorRaw,
      accelerator
    });
  }

  private normalizeAccelerator(source: string): string {
    return source
      .split("+")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const lower = part.toLowerCase();
        if (lower === "option" || lower === "alt") {
          return "Alt";
        }

        if (lower === "cmd" || lower === "command") {
          return "Command";
        }

        if (lower === "ctrl" || lower === "control") {
          return "Control";
        }

        if (lower === "shift") {
          return "Shift";
        }

        return part.length === 1 ? part.toUpperCase() : `${part[0].toUpperCase()}${part.slice(1)}`;
      })
      .join("+");
  }
}
