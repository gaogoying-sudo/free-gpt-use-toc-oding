import { Point, Rect } from "./geometry";

export interface HotkeyConfig {
  startResume: string;
  stop: string;
  recalibrate: string;
}

export interface RetryConfig {
  send: number;
  maxHoverAttempts: number;
  maxCopyAttempts: number;
  maxActivationAttempts: number;
}

export interface TimingConfig {
  pollingIntervalMs: number;
  actionDelayMs: number;
  hoverDwellMs: number;
  postActivationSettleMs: number;
  postScrollSettleMs: number;
  postHoverSettleMs: number;
  clipboardVerifyTimeoutMs: number;
  roiStabilityWindowMs: number;
}

export interface TimeoutConfig {
  sendMs: number;
  waitForCompletionMs: number;
  copyMs: number;
}

export interface DebugConfig {
  enabled: boolean;
  mockAutomation: boolean;
}

export interface ChatGPTCalibration {
  version: number;
  inputAnchor: Point | null;
  sendButtonAnchor: Point | null;
  scrollBottomAnchor: Point | null;
  copySearchAnchor: Point | null;
  latestReplyStableRoi: Rect | null;
  responseRoi: Rect | null;
  copyCandidateOffsets: Point[];
  minSendSignals: number;
}

export interface CodexCalibration {
  version: number;
  inputAnchor: Point | null;
  paneActivationPoint: Point | null;
  replyAreaActivationPoint: Point | null;
  hoverBandAnchor: Point | null;
  copyCandidatePoints: Point[];
  stableRoi: Rect | null;
  responseRoi: Rect | null;
  bottomAnchor: Point | null;
  bottomDetectionRoi: Rect | null;
  hoverOffsets: Point[];
  minSendSignals: number;
}

export interface CalibrationConfig {
  calibrated: boolean;
  leftVersion: number;
  rightVersion: number;
  chatgpt: ChatGPTCalibration;
  codex: CodexCalibration;
}

export interface WindowManagerConfig {
  chatgptAppName: string;
  codexAppName: string;
}

export interface ScreenProbeConfig {
  roiPixelDiffThreshold: number;
  changeDeltaThreshold: number;
}

export interface BridgeConfig {
  version: number;
  hotkeys: HotkeyConfig;
  retries: RetryConfig;
  timing: TimingConfig;
  timeout: TimeoutConfig;
  debug: DebugConfig;
  windows: WindowManagerConfig;
  screenProbe: ScreenProbeConfig;
  calibration: CalibrationConfig;
}
