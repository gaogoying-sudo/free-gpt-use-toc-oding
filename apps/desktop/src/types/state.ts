export enum BridgeState {
  IDLE = "IDLE",
  WAITING_GPT = "WAITING_GPT",
  COPYING_GPT = "COPYING_GPT",
  SENDING_TO_CODEX = "SENDING_TO_CODEX",
  WAITING_CODEX = "WAITING_CODEX",
  COPYING_CODEX = "COPYING_CODEX",
  SENDING_TO_GPT = "SENDING_TO_GPT",
  PAUSED = "PAUSED",
  ERROR = "ERROR",
  STOPPED = "STOPPED"
}

export interface StateChange {
  from: BridgeState;
  to: BridgeState;
  reason: string;
  at: string;
}
