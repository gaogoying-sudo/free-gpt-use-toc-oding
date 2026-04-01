import { dialog, screen } from "electron";
import { BridgeConfig } from "../types/config";
import { Point, Rect } from "../types/geometry";
import { Logger } from "../services/logger/logger";

export type CalibrationTarget = "all" | "left" | "right";

export interface CalibrationStatus {
  leftCalibrated: boolean;
  rightCalibrated: boolean;
  missingLeft: string[];
  missingRight: string[];
}

type CalibrationStepKey =
  | "chatgpt.inputAnchor"
  | "chatgpt.sendButtonAnchor"
  | "chatgpt.scrollBottomAnchor"
  | "chatgpt.copySearchAnchor"
  | "chatgpt.latestReplyRoiAnchor"
  | "codex.inputAnchor"
  | "codex.paneActivationPoint"
  | "codex.replyAreaActivationPoint"
  | "codex.hoverBandAnchor"
  | "codex.copyCandidatePoint1"
  | "codex.copyCandidatePoint2"
  | "codex.copyCandidatePoint3"
  | "codex.stableRoiAnchor"
  | "codex.bottomAnchor"
  | "codex.bottomDetectionRoiAnchor";

interface CalibrationStep {
  key: CalibrationStepKey;
  title: string;
  detail: string;
}

const LEFT_STEPS: CalibrationStep[] = [
  {
    key: "chatgpt.inputAnchor",
    title: "左侧 1/5：ChatGPT 输入框锚点",
    detail: "把鼠标移动到左侧 ChatGPT 输入框中心，然后点击 Capture。"
  },
  {
    key: "chatgpt.sendButtonAnchor",
    title: "左侧 2/5：ChatGPT 发送按钮锚点",
    detail: "把鼠标移动到左侧 ChatGPT 发送按钮中心，然后点击 Capture。"
  },
  {
    key: "chatgpt.scrollBottomAnchor",
    title: "左侧 3/5：ChatGPT 回到底部按钮锚点",
    detail: "把鼠标移动到左侧 ChatGPT 向下箭头按钮中心，然后点击 Capture。"
  },
  {
    key: "chatgpt.copySearchAnchor",
    title: "左侧 4/5：ChatGPT copy 搜索锚点",
    detail: "把鼠标移动到左侧最新回复底部 copy 可能出现区域，然后点击 Capture。"
  },
  {
    key: "chatgpt.latestReplyRoiAnchor",
    title: "左侧 5/5：ChatGPT latest reply stable ROI 锚点",
    detail: "把鼠标移动到左侧最新回复文本区域中间，然后点击 Capture。"
  }
];

const RIGHT_STEPS: CalibrationStep[] = [
  {
    key: "codex.inputAnchor",
    title: "右侧 1/10：Codex 输入框锚点",
    detail: "把鼠标移动到右侧 Codex 输入框中心，然后点击 Capture。"
  },
  {
    key: "codex.paneActivationPoint",
    title: "右侧 2/10：Codex pane 激活点",
    detail: "把鼠标移动到右侧 Codex 面板标题或可激活区域，然后点击 Capture。"
  },
  {
    key: "codex.replyAreaActivationPoint",
    title: "右侧 3/10：回复区激活点",
    detail: "把鼠标移动到右侧最新回复正文区域（可点击激活）然后点击 Capture。"
  },
  {
    key: "codex.hoverBandAnchor",
    title: "右侧 4/10：hover 候选带锚点",
    detail: "把鼠标移动到最新回复底部操作条大概中心，然后点击 Capture。"
  },
  {
    key: "codex.copyCandidatePoint1",
    title: "右侧 5/10：copy 候选点 #1",
    detail: "把鼠标移动到 copy 可能出现位置 #1，然后点击 Capture。"
  },
  {
    key: "codex.copyCandidatePoint2",
    title: "右侧 6/10：copy 候选点 #2",
    detail: "把鼠标移动到 copy 可能出现位置 #2，然后点击 Capture。"
  },
  {
    key: "codex.copyCandidatePoint3",
    title: "右侧 7/10：copy 候选点 #3",
    detail: "把鼠标移动到 copy 可能出现位置 #3，然后点击 Capture。"
  },
  {
    key: "codex.stableRoiAnchor",
    title: "右侧 8/10：stable ROI 锚点",
    detail: "把鼠标移动到右侧最新回复区域中间，然后点击 Capture。"
  },
  {
    key: "codex.bottomAnchor",
    title: "右侧 9/10：底部锚点",
    detail: "把鼠标移动到右侧最底部回复附近可点击位置，然后点击 Capture。"
  },
  {
    key: "codex.bottomDetectionRoiAnchor",
    title: "右侧 10/10：bottom detection ROI 锚点",
    detail: "把鼠标移动到右侧底部检测区域中间，然后点击 Capture。"
  }
];

export class CalibrationService {
  private leftRoiAnchor: Point | null = null;
  private rightStableRoiAnchor: Point | null = null;
  private rightBottomRoiAnchor: Point | null = null;

  constructor(private readonly logger: Logger) {}

  isCalibrated(config: BridgeConfig): boolean {
    const status = this.getStatus(config);
    return status.leftCalibrated && status.rightCalibrated;
  }

  isLeftCalibrated(config: BridgeConfig): boolean {
    return this.getStatus(config).leftCalibrated;
  }

  isRightCalibrated(config: BridgeConfig): boolean {
    return this.getStatus(config).rightCalibrated;
  }

  getStatus(config: BridgeConfig): CalibrationStatus {
    const left = config.calibration.chatgpt;
    const right = config.calibration.codex;

    const missingLeft: string[] = [];
    if (!left.inputAnchor) missingLeft.push("chatgpt.inputAnchor");
    if (!left.sendButtonAnchor) missingLeft.push("chatgpt.sendButtonAnchor");
    if (!left.scrollBottomAnchor) missingLeft.push("chatgpt.scrollBottomAnchor");
    if (!left.copySearchAnchor) missingLeft.push("chatgpt.copySearchAnchor");
    if (!left.latestReplyStableRoi) missingLeft.push("chatgpt.latestReplyStableRoi");

    const missingRight: string[] = [];
    if (!right.inputAnchor) missingRight.push("codex.inputAnchor");
    if (!right.paneActivationPoint) missingRight.push("codex.paneActivationPoint");
    if (!right.replyAreaActivationPoint) missingRight.push("codex.replyAreaActivationPoint");
    if (!right.hoverBandAnchor) missingRight.push("codex.hoverBandAnchor");
    if (!right.copyCandidatePoints.length) missingRight.push("codex.copyCandidatePoints");
    if (!right.stableRoi) missingRight.push("codex.stableRoi");
    if (!right.bottomAnchor && !right.bottomDetectionRoi) {
      missingRight.push("codex.bottomAnchor|codex.bottomDetectionRoi");
    }

    return {
      leftCalibrated: missingLeft.length === 0,
      rightCalibrated: missingRight.length === 0,
      missingLeft,
      missingRight
    };
  }

  async run(config: BridgeConfig, target: CalibrationTarget = "all"): Promise<BridgeConfig | null> {
    this.leftRoiAnchor = null;
    this.rightStableRoiAnchor = null;
    this.rightBottomRoiAnchor = null;

    const next = structuredClone(config);
    const steps = this.resolveSteps(target);

    for (const step of steps) {
      const result = await dialog.showMessageBox({
        type: "info",
        title: "Mac GPT ↔ Codex Bridge 校准",
        message: step.title,
        detail: `${step.detail}\n\n准备好后点击 Capture。`,
        buttons: ["Capture", "Cancel"],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      });

      if (result.response === 1) {
        this.logger.warn("calibration cancelled", { step: step.key, target });
        return null;
      }

      const point = screen.getCursorScreenPoint();
      this.setAnchor(next, step.key, point);
      this.logger.info("captured calibration anchor", {
        step: step.key,
        point,
        target
      });
    }

    this.deriveRois(next, target);
    next.calibration.leftVersion = 2;
    next.calibration.rightVersion = 2;
    next.calibration.chatgpt.version = 2;
    next.calibration.codex.version = 2;

    const status = this.getStatus(next);
    next.calibration.calibrated = status.leftCalibrated && status.rightCalibrated;

    this.logger.info("calibration status", status);

    await dialog.showMessageBox({
      type: "info",
      title: "校准完成",
      message: this.statusMessage(status),
      detail: this.statusDetail(status),
      buttons: ["OK"],
      defaultId: 0,
      noLink: true
    });

    return next;
  }

  private resolveSteps(target: CalibrationTarget): CalibrationStep[] {
    if (target === "left") {
      return LEFT_STEPS;
    }

    if (target === "right") {
      return RIGHT_STEPS;
    }

    return [...LEFT_STEPS, ...RIGHT_STEPS];
  }

  private setAnchor(config: BridgeConfig, key: CalibrationStepKey, point: Point): void {
    switch (key) {
      case "chatgpt.inputAnchor":
        config.calibration.chatgpt.inputAnchor = point;
        return;
      case "chatgpt.sendButtonAnchor":
        config.calibration.chatgpt.sendButtonAnchor = point;
        return;
      case "chatgpt.scrollBottomAnchor":
        config.calibration.chatgpt.scrollBottomAnchor = point;
        return;
      case "chatgpt.copySearchAnchor":
        config.calibration.chatgpt.copySearchAnchor = point;
        return;
      case "chatgpt.latestReplyRoiAnchor":
        this.leftRoiAnchor = point;
        return;
      case "codex.inputAnchor":
        config.calibration.codex.inputAnchor = point;
        return;
      case "codex.paneActivationPoint":
        config.calibration.codex.paneActivationPoint = point;
        return;
      case "codex.replyAreaActivationPoint":
        config.calibration.codex.replyAreaActivationPoint = point;
        return;
      case "codex.hoverBandAnchor":
        config.calibration.codex.hoverBandAnchor = point;
        return;
      case "codex.copyCandidatePoint1":
      case "codex.copyCandidatePoint2":
      case "codex.copyCandidatePoint3":
        this.assignCopyCandidatePoint(config, key, point);
        return;
      case "codex.stableRoiAnchor":
        this.rightStableRoiAnchor = point;
        return;
      case "codex.bottomAnchor":
        config.calibration.codex.bottomAnchor = point;
        return;
      case "codex.bottomDetectionRoiAnchor":
        this.rightBottomRoiAnchor = point;
        return;
    }
  }

  private assignCopyCandidatePoint(
    config: BridgeConfig,
    key: "codex.copyCandidatePoint1" | "codex.copyCandidatePoint2" | "codex.copyCandidatePoint3",
    point: Point
  ): void {
    const index = key.endsWith("1") ? 0 : key.endsWith("2") ? 1 : 2;
    const next = [...config.calibration.codex.copyCandidatePoints];
    while (next.length < 3) {
      next.push(point);
    }
    next[index] = point;
    config.calibration.codex.copyCandidatePoints = next;
  }

  private deriveRois(config: BridgeConfig, target: CalibrationTarget): void {
    if (target === "all" || target === "left") {
      const leftAnchor = this.leftRoiAnchor ?? config.calibration.chatgpt.copySearchAnchor;
      if (leftAnchor) {
        config.calibration.chatgpt.latestReplyStableRoi = this.roiFromAnchor(leftAnchor, {
          x: -520,
          y: -260,
          width: 1040,
          height: 240
        });
        config.calibration.chatgpt.responseRoi = config.calibration.chatgpt.latestReplyStableRoi;
      }
    }

    if (target === "all" || target === "right") {
      const stableAnchor = this.rightStableRoiAnchor ?? config.calibration.codex.hoverBandAnchor;
      if (stableAnchor) {
        config.calibration.codex.stableRoi = this.roiFromAnchor(stableAnchor, {
          x: -560,
          y: -320,
          width: 1120,
          height: 300
        });
        config.calibration.codex.responseRoi = config.calibration.codex.stableRoi;
      }

      const bottomAnchor = this.rightBottomRoiAnchor ?? config.calibration.codex.bottomAnchor;
      if (bottomAnchor) {
        config.calibration.codex.bottomDetectionRoi = this.roiFromAnchor(bottomAnchor, {
          x: -280,
          y: -60,
          width: 560,
          height: 120
        });
      }
    }
  }

  private roiFromAnchor(
    anchor: Point,
    relative: { x: number; y: number; width: number; height: number }
  ): Rect {
    return {
      x: Math.round(anchor.x + relative.x),
      y: Math.round(anchor.y + relative.y),
      width: relative.width,
      height: relative.height
    };
  }

  private statusMessage(status: CalibrationStatus): string {
    if (status.leftCalibrated && status.rightCalibrated) {
      return "左右校准均完成，可直接开始实机桥接。";
    }

    if (status.leftCalibrated && !status.rightCalibrated) {
      return "左侧已完成，右侧仍有缺失点位。";
    }

    if (!status.leftCalibrated && status.rightCalibrated) {
      return "右侧已完成，左侧仍有缺失点位。";
    }

    return "左右两侧均存在缺失点位，请继续校准。";
  }

  private statusDetail(status: CalibrationStatus): string {
    const leftMissing = status.missingLeft.length
      ? `Left missing: ${status.missingLeft.join(", ")}`
      : "Left missing: none";

    const rightMissing = status.missingRight.length
      ? `Right missing: ${status.missingRight.join(", ")}`
      : "Right missing: none";

    return `${leftMissing}\n${rightMissing}`;
  }
}
