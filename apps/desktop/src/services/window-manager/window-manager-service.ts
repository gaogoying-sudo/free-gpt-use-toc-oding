import { BridgeConfig } from "../../types/config";
import { Rect } from "../../types/geometry";
import { Logger } from "../logger/logger";
import { runCommand } from "../automation/command-runner";
import { AutomationService } from "../automation/automation-service";

export class WindowManagerService {
  constructor(
    private readonly getConfig: () => BridgeConfig,
    private readonly automation: AutomationService,
    private readonly logger: Logger
  ) {}

  async focusChatGPT(signal?: AbortSignal): Promise<void> {
    await this.automation.activateApplication(this.getConfig().windows.chatgptAppName, signal);
    this.logger.debug("focused ChatGPT window");
  }

  async focusCodex(signal?: AbortSignal): Promise<void> {
    await this.automation.activateApplication(this.getConfig().windows.codexAppName, signal);
    this.logger.debug("focused Codex window");
  }

  async bringToFront(appName: string, signal?: AbortSignal): Promise<void> {
    await this.automation.activateApplication(appName, signal);
  }

  async getFrontWindowBounds(appName: string): Promise<Rect | null> {
    const args = [
      "-e",
      `tell application \"${appName}\"`,
      "-e",
      "if (count of windows) is 0 then return \"\"",
      "-e",
      "set b to bounds of front window",
      "-e",
      "return (item 1 of b as string) & \",\" & (item 2 of b as string) & \",\" & (item 3 of b as string) & \",\" & (item 4 of b as string)",
      "-e",
      "end tell"
    ];

    try {
      const { stdout } = await runCommand("/usr/bin/osascript", args, 5000);
      if (!stdout) {
        return null;
      }

      const parts = stdout.split(",").map((part) => Number(part.trim()));
      if (parts.length !== 4 || parts.some((value) => Number.isNaN(value))) {
        return null;
      }

      const [left, top, right, bottom] = parts;
      return {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top
      };
    } catch (error) {
      this.logger.warn("failed to fetch front window bounds", {
        appName,
        error: String(error)
      });
      return null;
    }
  }
}
