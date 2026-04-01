import { BridgeConfig } from "../types/config";

export const DEFAULT_CONFIG: BridgeConfig = {
  version: 3,
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
  codex: {
    responseBodyActivationRatio: {
      x: 0.74,
      y: 0.44
    },
    responseBodyRoiRatio: {
      x: 0.5,
      y: 0.1,
      width: 0.48,
      height: 0.66
    },
    followUpInputRoiRatio: {
      x: 0.5,
      y: 0.78,
      width: 0.48,
      height: 0.2
    },
    promptFingerprintChars: 96,
    maxTranscriptChars: 140_000,
    minExtractedReplyLength: 20
  },
  calibration: {
    calibrated: false,
    leftVersion: 2,
    rightVersion: 3,
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
      version: 3,
      inputAnchor: null,
      stableRoi: null,
      responseRoi: null,
      minSendSignals: 2
    }
  }
};
