import { BridgeConfig } from "../types/config";

export const DEFAULT_CONFIG: BridgeConfig = {
  version: 2,
  hotkeys: {
    startResume: "Command+Option+Control+S",
    stop: "Command+Option+Control+X",
    recalibrate: "Command+Option+Control+K"
  },
  retries: {
    send: 3,
    maxHoverAttempts: 3,
    maxCopyAttempts: 3,
    maxActivationAttempts: 2
  },
  timing: {
    pollingIntervalMs: 500,
    actionDelayMs: 180,
    hoverDwellMs: 240,
    postActivationSettleMs: 260,
    postScrollSettleMs: 260,
    postHoverSettleMs: 120,
    clipboardVerifyTimeoutMs: 1200,
    roiStabilityWindowMs: 3000
  },
  timeout: {
    sendMs: 20_000,
    waitForCompletionMs: 240_000,
    copyMs: 20_000
  },
  debug: {
    enabled: true,
    mockAutomation: false
  },
  windows: {
    chatgptAppName: "Google Chrome",
    codexAppName: "Visual Studio Code"
  },
  screenProbe: {
    roiPixelDiffThreshold: 0.012,
    changeDeltaThreshold: 0.028
  },
  calibration: {
    calibrated: false,
    leftVersion: 2,
    rightVersion: 2,
    chatgpt: {
      version: 2,
      inputAnchor: null,
      sendButtonAnchor: null,
      scrollBottomAnchor: null,
      copySearchAnchor: null,
      latestReplyStableRoi: null,
      responseRoi: null,
      copyCandidateOffsets: [
        { x: -36, y: 0 },
        { x: 0, y: 0 },
        { x: 36, y: 0 }
      ],
      minSendSignals: 2
    },
    codex: {
      version: 2,
      inputAnchor: null,
      paneActivationPoint: null,
      replyAreaActivationPoint: null,
      hoverBandAnchor: null,
      copyCandidatePoints: [],
      stableRoi: null,
      responseRoi: null,
      bottomAnchor: null,
      bottomDetectionRoi: null,
      hoverOffsets: [
        { x: -180, y: 0 },
        { x: -90, y: 0 },
        { x: 0, y: 0 },
        { x: 90, y: 0 },
        { x: 180, y: 0 }
      ],
      minSendSignals: 2
    }
  }
};
