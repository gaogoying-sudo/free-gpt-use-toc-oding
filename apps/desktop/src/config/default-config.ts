import { BridgeConfig } from "../types/config";

export const DEFAULT_CONFIG: BridgeConfig = {
  version: 1,
  hotkeys: {
    startResume: "Command+Option+Control+S",
    stop: "Command+Option+Control+X",
    recalibrate: "Command+Option+Control+K"
  },
  retries: {
    copy: 3,
    send: 3,
    hover: 3
  },
  timing: {
    pollingIntervalMs: 500,
    stabilityWindowMs: 3000,
    actionDelayMs: 180,
    hoverDwellMs: 220,
    copyCheckDelayMs: 220
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
    stableDeltaThreshold: 0.012,
    changeDeltaThreshold: 0.028
  },
  calibration: {
    calibrated: false,
    chatgpt: {
      inputAnchor: null,
      sendButtonAnchor: null,
      scrollBottomAnchor: null,
      copySearchAnchor: null,
      responseRoi: null,
      copyCandidateOffsets: [
        { x: -36, y: 0 },
        { x: 0, y: 0 },
        { x: 36, y: 0 }
      ],
      minSendSignals: 2
    },
    codex: {
      inputAnchor: null,
      hoverBandAnchor: null,
      copyCandidateAnchor: null,
      responseRoi: null,
      hoverOffsets: [
        { x: -180, y: 0 },
        { x: -90, y: 0 },
        { x: 0, y: 0 },
        { x: 90, y: 0 },
        { x: 180, y: 0 }
      ],
      copyCandidateOffsets: [
        { x: -32, y: 0 },
        { x: 0, y: 0 },
        { x: 32, y: 0 }
      ],
      minSendSignals: 2
    }
  }
};
