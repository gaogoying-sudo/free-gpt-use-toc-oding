export const STEP_CODES = {
  VSCODE_WINDOW_FOCUS_FAILED: "VSCODE_WINDOW_FOCUS_FAILED",
  CODEX_PANE_ACTIVATION_FAILED: "CODEX_PANE_ACTIVATION_FAILED",
  CODEX_REPLY_AREA_ACTIVATION_FAILED: "CODEX_REPLY_AREA_ACTIVATION_FAILED",
  CODEX_SCROLL_BOTTOM_FAILED: "CODEX_SCROLL_BOTTOM_FAILED",
  CODEX_HOVER_REVEAL_FAILED: "CODEX_HOVER_REVEAL_FAILED",
  CODEX_COPY_CLICK_FAILED: "CODEX_COPY_CLICK_FAILED",
  CODEX_CLIPBOARD_NOT_CHANGED: "CODEX_CLIPBOARD_NOT_CHANGED",
  CHATGPT_SEND_NOT_CONFIRMED: "CHATGPT_SEND_NOT_CONFIRMED",
  CHATGPT_OUTPUT_NOT_STABLE: "CHATGPT_OUTPUT_NOT_STABLE",
  CHATGPT_COPY_FAILED: "CHATGPT_COPY_FAILED"
} as const;

export type StepCode = (typeof STEP_CODES)[keyof typeof STEP_CODES];

export class StepError extends Error {
  constructor(
    public readonly code: StepCode,
    message: string,
    public readonly details: Record<string, unknown> = {}
  ) {
    super(`${code}: ${message}`);
    this.name = "StepError";
  }
}

export const getStepCode = (error: unknown): StepCode | null => {
  if (error instanceof StepError) {
    return error.code;
  }
  return null;
};
