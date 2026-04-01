import { Point, Rect } from "./geometry";

export interface HotkeyConfig {
  startResume: string;
  stop: string;
  recalibrate: string;
}

export interface RetryConfig {
  copy: number;
  send: number;
  hover: number;
}

export interface TimingConfig {
  pollingIntervalMs: number;
  stabilityWindowMs: number;
  actionDelayMs: number;
  hoverDwellMs: number;
  copyCheckDelayMs: number;
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
  inputAnchor: Point | null;
  sendButtonAnchor: Point | null;
  scrollBottomAnchor: Point | null;
  copySearchAnchor: Point | null;
  responseRoi: Rect | null;
  copyCandidateOffsets: Point[];
  minSendSignals: number;
}

export interface CodexCalibration {
  inputAnchor: Point | null;
  hoverBandAnchor: Point | null;
  copyCandidateAnchor: Point | null;
  responseRoi: Rect | null;
  hoverOffsets: Point[];
  copyCandidateOffsets: Point[];
  minSendSignals: number;
}

export interface CalibrationConfig {
  calibrated: boolean;
  chatgpt: ChatGPTCalibration;
  codex: CodexCalibration;
}

export interface WindowManagerConfig {
  chatgptAppName: string;
  codexAppName: string;
}

export interface ScreenProbeConfig {
  stableDeltaThreshold: number;
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
