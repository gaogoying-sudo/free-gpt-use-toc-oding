import { EventEmitter } from "node:events";
import { BridgeConfig } from "../types/config";
import { BridgeState, StateChange } from "../types/state";
import { ConversationAdapter } from "../adapters/conversation-adapter";
import { ClipboardService } from "../services/clipboard/clipboard-service";
import { Logger } from "../services/logger/logger";

export interface StartOptions {
  singleRound?: boolean;
}

export interface BridgeOrchestratorEvents {
  stateChanged: (event: StateChange) => void;
  roundCompleted: (round: number) => void;
}

export class BridgeOrchestrator extends EventEmitter {
  private state: BridgeState = BridgeState.IDLE;
  private running = false;
  private stopRequested = false;
  private activeLoopPromise: Promise<void> | null = null;
  private activeAbortController: AbortController | null = null;
  private round = 0;
  private lastGptHash: string | null = null;
  private lastCodexHash: string | null = null;

  constructor(
    private readonly getConfig: () => BridgeConfig,
    private readonly chatgpt: ConversationAdapter,
    private readonly codex: ConversationAdapter,
    private readonly clipboard: ClipboardService,
    private readonly logger: Logger
  ) {
    super();
  }

  on<K extends keyof BridgeOrchestratorEvents>(
    eventName: K,
    listener: BridgeOrchestratorEvents[K]
  ): this {
    return super.on(eventName, listener);
  }

  getState(): BridgeState {
    return this.state;
  }

  async start(options: StartOptions = {}): Promise<void> {
    if (this.running) {
      this.logger.warn("start ignored because orchestrator is already running");
      return;
    }

    this.stopRequested = false;
    this.running = true;
    this.activeAbortController = new AbortController();

    this.activeLoopPromise = this.loop(Boolean(options.singleRound), this.activeAbortController.signal)
      .catch((error) => {
        if (this.stopRequested || String(error).includes("Aborted")) {
          this.logger.info("loop aborted", { reason: String(error) });
          return;
        }

        this.logger.error("orchestration loop failed", { error: String(error) });
        this.transitionTo(BridgeState.ERROR, String(error));
      })
      .finally(() => {
        this.running = false;
        this.activeLoopPromise = null;
        this.activeAbortController = null;

        if (this.state === BridgeState.PAUSED) {
          return;
        }

        if (this.state !== BridgeState.ERROR) {
          this.transitionTo(
            this.stopRequested ? BridgeState.STOPPED : BridgeState.IDLE,
            this.stopRequested ? "stop requested" : "loop ended"
          );
        }
      });

    await this.activeLoopPromise;
  }

  async stop(reason = "manual stop"): Promise<void> {
    this.stopRequested = true;
    this.transitionTo(BridgeState.STOPPED, reason);
    this.activeAbortController?.abort();

    if (this.activeLoopPromise) {
      await this.activeLoopPromise;
    }
  }

  async pause(reason = "manual pause"): Promise<void> {
    this.stopRequested = true;
    this.transitionTo(BridgeState.PAUSED, reason);
    this.activeAbortController?.abort();

    if (this.activeLoopPromise) {
      await this.activeLoopPromise;
    }
  }

  private async loop(singleRound: boolean, signal: AbortSignal): Promise<void> {
    while (!this.stopRequested) {
      this.transitionTo(BridgeState.WAITING_GPT, "waiting for ChatGPT output completion");
      await this.chatgpt.waitForLatestResponseComplete(signal);

      this.ensureCanContinue();
      this.transitionTo(BridgeState.COPYING_GPT, "copying latest ChatGPT reply");
      const gptText = await this.chatgpt.copyLatestReply(signal);

      if (!this.acceptPayload("gpt", gptText)) {
        this.logger.warn("skipped forwarding from GPT due to dedupe/empty payload");
        continue;
      }

      this.ensureCanContinue();
      this.transitionTo(BridgeState.SENDING_TO_CODEX, "sending payload to Codex");
      await this.runWithRetries("send_to_codex", this.getConfig().retries.send, async () => {
        await this.codex.sendMessage(gptText, signal);
      });

      this.ensureCanContinue();
      this.transitionTo(BridgeState.WAITING_CODEX, "waiting for Codex output completion");
      await this.codex.waitForLatestResponseComplete(signal);

      this.ensureCanContinue();
      this.transitionTo(BridgeState.COPYING_CODEX, "copying latest Codex reply");
      const codexText = await this.codex.copyLatestReply(signal);

      if (!this.acceptPayload("codex", codexText)) {
        this.logger.warn("skipped forwarding from Codex due to dedupe/empty payload");
        continue;
      }

      this.ensureCanContinue();
      this.transitionTo(BridgeState.SENDING_TO_GPT, "sending payload back to ChatGPT");
      await this.runWithRetries("send_to_gpt", this.getConfig().retries.send, async () => {
        await this.chatgpt.sendMessage(codexText, signal);
      });

      this.round += 1;
      this.emit("roundCompleted", this.round);
      this.logger.info("round completed", { round: this.round });

      if (singleRound) {
        this.stopRequested = true;
        break;
      }
    }
  }

  private acceptPayload(source: "gpt" | "codex", text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) {
      return false;
    }

    const hash = this.clipboard.getHash(trimmed);
    if (source === "gpt") {
      if (this.lastGptHash === hash) {
        return false;
      }
      this.lastGptHash = hash;
      return true;
    }

    if (this.lastCodexHash === hash) {
      return false;
    }

    this.lastCodexHash = hash;
    return true;
  }

  private ensureCanContinue(): void {
    if (this.stopRequested) {
      throw new Error("Aborted by stop request");
    }
  }

  private async runWithRetries(
    action: string,
    maxRetries: number,
    fn: () => Promise<void>
  ): Promise<void> {
    const attempts = Math.max(1, maxRetries);

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await fn();
        return;
      } catch (error) {
        this.logger.warn("action failed", {
          action,
          attempt,
          attempts,
          error: String(error)
        });

        if (attempt === attempts) {
          throw error;
        }
      }
    }
  }

  private transitionTo(next: BridgeState, reason: string): void {
    if (this.state === next) {
      return;
    }

    const event: StateChange = {
      from: this.state,
      to: next,
      reason,
      at: new Date().toISOString()
    };

    this.state = next;
    this.emit("stateChanged", event);
    this.logger.info("state transition", event);
  }
}
