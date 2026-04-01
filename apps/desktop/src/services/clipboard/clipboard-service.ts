import crypto from "node:crypto";
import { clipboard } from "electron";
import { Logger } from "../logger/logger";
import { sleep, throwIfAborted } from "../utils";

export interface ClipboardWaitOptions {
  retries: number;
  delayMs: number;
  requireNonEmpty?: boolean;
  signal?: AbortSignal;
}

export class ClipboardService {
  constructor(private readonly logger: Logger) {}

  getText(): string {
    return clipboard.readText();
  }

  setText(value: string): void {
    clipboard.writeText(value);
  }

  getHash(value?: string): string {
    const text = value ?? this.getText();
    return crypto.createHash("sha256").update(text).digest("hex");
  }

  async waitForHashChange(
    previousHash: string,
    options: ClipboardWaitOptions
  ): Promise<{ changed: boolean; hash: string; text: string }> {
    const retries = Math.max(1, options.retries);

    for (let attempt = 1; attempt <= retries; attempt += 1) {
      throwIfAborted(options.signal);
      await sleep(options.delayMs, options.signal);

      const text = this.getText();
      const hash = this.getHash(text);
      const nonEmpty = text.trim().length > 0;
      const changed = hash !== previousHash && (!options.requireNonEmpty || nonEmpty);

      this.logger.debug("clipboard check", {
        attempt,
        changed,
        hash,
        requireNonEmpty: options.requireNonEmpty ?? false,
        length: text.length
      });

      if (changed) {
        return { changed: true, hash, text };
      }
    }

    return {
      changed: false,
      hash: this.getHash(),
      text: this.getText()
    };
  }
}
