import fs from "node:fs/promises";
import path from "node:path";

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export class Logger {
  private readonly logFilePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(logsDir: string, private readonly debugEnabled: boolean) {
    this.logFilePath = path.join(logsDir, "bridge.log");
  }

  getLogFilePath(): string {
    return this.logFilePath;
  }

  debug(message: string, context?: unknown): void {
    if (!this.debugEnabled) {
      return;
    }
    this.write("DEBUG", message, context);
  }

  info(message: string, context?: unknown): void {
    this.write("INFO", message, context);
  }

  warn(message: string, context?: unknown): void {
    this.write("WARN", message, context);
  }

  error(message: string, context?: unknown): void {
    this.write("ERROR", message, context);
  }

  private write(level: LogLevel, message: string, context?: unknown): void {
    const entry = {
      ts: new Date().toISOString(),
      level,
      message,
      context: context ?? {}
    };

    const line = JSON.stringify(entry);
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.appendFile(this.logFilePath, `${line}\n`, "utf8");
    });

    if (level === "ERROR") {
      console.error(`[${level}] ${message}`, context ?? "");
    } else if (level === "WARN") {
      console.warn(`[${level}] ${message}`, context ?? "");
    } else {
      console.log(`[${level}] ${message}`, context ?? "");
    }
  }
}
