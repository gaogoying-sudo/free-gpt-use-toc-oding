import { BridgeConfig } from "../../types/config";
import { Point } from "../../types/geometry";
import { Logger } from "../logger/logger";
import { sleep, throwIfAborted } from "../utils";
import { runCommand } from "./command-runner";

export class AutomationService {
  constructor(
    private readonly getConfig: () => BridgeConfig,
    private readonly logger: Logger
  ) {}

  async activateApplication(appName: string, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);

    if (this.isMock()) {
      this.logger.debug("[mock] activateApplication", { appName });
      await sleep(this.getConfig().timing.actionDelayMs, signal);
      return;
    }

    await this.runAppleScript([`tell application "${appName}" to activate`]);
    await sleep(this.getConfig().timing.actionDelayMs, signal);
  }

  async moveMouse(point: Point, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);

    if (this.isMock()) {
      this.logger.debug("[mock] moveMouse", point);
      await sleep(this.getConfig().timing.actionDelayMs, signal);
      return;
    }

    await this.runSwift(`
      import CoreGraphics
      let point = CGPoint(x: ${Math.round(point.x)}, y: ${Math.round(point.y)})
      CGWarpMouseCursorPosition(point)
    `);
  }

  async leftClick(point: Point, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);

    if (this.isMock()) {
      this.logger.debug("[mock] leftClick", point);
      await sleep(this.getConfig().timing.actionDelayMs, signal);
      return;
    }

    await this.runSwift(`
      import CoreGraphics
      let point = CGPoint(x: ${Math.round(point.x)}, y: ${Math.round(point.y)})
      let source = CGEventSource(stateID: .combinedSessionState)
      let move = CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)
      move?.post(tap: .cghidEventTap)
      let down = CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)
      down?.post(tap: .cghidEventTap)
      let up = CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)
      up?.post(tap: .cghidEventTap)
    `);
    await sleep(this.getConfig().timing.actionDelayMs, signal);
  }

  async hover(point: Point, dwellMs: number, signal?: AbortSignal): Promise<void> {
    await this.moveMouse(point, signal);
    await sleep(dwellMs, signal);
  }

  async paste(signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    await this.systemEvents('keystroke "v" using {command down}');
    await sleep(this.getConfig().timing.actionDelayMs, signal);
  }

  async selectAll(signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    await this.systemEvents('keystroke "a" using {command down}');
    await sleep(this.getConfig().timing.actionDelayMs, signal);
  }

  async copy(signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    await this.systemEvents('keystroke "c" using {command down}');
    await sleep(this.getConfig().timing.actionDelayMs, signal);
  }

  async pressEnter(signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    await this.systemEvents("key code 36");
    await sleep(this.getConfig().timing.actionDelayMs, signal);
  }

  async pressCommandDown(signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    await this.systemEvents("key code 125 using {command down}");
    await sleep(this.getConfig().timing.actionDelayMs, signal);
  }

  async pressEscape(signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    await this.systemEvents("key code 53");
    await sleep(this.getConfig().timing.actionDelayMs, signal);
  }

  private async systemEvents(statement: string): Promise<void> {
    if (this.isMock()) {
      this.logger.debug("[mock] systemEvents", { statement });
      return;
    }

    await this.runAppleScript([
      'tell application "System Events"',
      statement,
      "end tell"
    ]);
  }

  private async runAppleScript(lines: string[]): Promise<void> {
    if (this.isMock()) {
      this.logger.debug("[mock] runAppleScript", { lines });
      return;
    }

    const args: string[] = [];
    for (const line of lines) {
      args.push("-e", line);
    }

    await runCommand("/usr/bin/osascript", args, this.getConfig().timeout.sendMs);
  }

  private async runSwift(code: string): Promise<void> {
    if (this.isMock()) {
      this.logger.debug("[mock] runSwift", { code });
      return;
    }

    await runCommand("/usr/bin/swift", ["-e", code], this.getConfig().timeout.sendMs);
  }

  private isMock(): boolean {
    return this.getConfig().debug.mockAutomation;
  }
}
