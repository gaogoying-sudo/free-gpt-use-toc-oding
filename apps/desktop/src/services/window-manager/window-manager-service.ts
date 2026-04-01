import { BridgeConfig } from "../../types/config";
import { Rect } from "../../types/geometry";
import { Logger } from "../logger/logger";
import { runCommand } from "../automation/command-runner";
import { AutomationService } from "../automation/automation-service";
import { sleep } from "../utils";

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

  async getFrontmostApplicationName(): Promise<string | null> {
    const args = [
      "-e",
      'tell application "System Events"',
      "-e",
      "if (count of application processes whose frontmost is true) is 0 then return \"\"",
      "-e",
      "set p to first application process whose frontmost is true",
      "-e",
      "return name of p",
      "-e",
      "end tell"
    ];

    try {
      const { stdout } = await runCommand("/usr/bin/osascript", args, 5000);
      return stdout || null;
    } catch (error) {
      this.logger.warn("failed to detect frontmost app", {
        error: String(error)
      });
      return null;
    }
  }

  async verifyFrontmostApplication(
    expectedName: string,
    options: {
      attempts?: number;
      settleMs?: number;
      signal?: AbortSignal;
    } = {}
  ): Promise<boolean> {
    const attempts = Math.max(1, options.attempts ?? 2);
    const settleMs = options.settleMs ?? this.getConfig().timing.postActivationSettleMs;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const current = await this.getFrontmostApplicationName();
      const matched = Boolean(current && current.toLowerCase().includes(expectedName.toLowerCase()));
      this.logger.debug("frontmost app verify", {
        attempt,
        expectedName,
        current,
        matched
      });

      if (matched) {
        return true;
      }

      await sleep(settleMs, options.signal);
    }

    return false;
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
