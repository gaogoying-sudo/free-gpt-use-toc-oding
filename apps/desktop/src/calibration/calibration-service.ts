import { dialog, screen } from "electron";
import { BridgeConfig } from "../types/config";
import { Point, Rect } from "../types/geometry";
import { Logger } from "../services/logger/logger";

interface CalibrationStep {
  key: "chatgpt.inputAnchor" | "chatgpt.sendButtonAnchor" | "chatgpt.scrollBottomAnchor" | "chatgpt.copySearchAnchor" | "codex.inputAnchor" | "codex.hoverBandAnchor" | "codex.copyCandidateAnchor";
  title: string;
  detail: string;
}

const CALIBRATION_STEPS: CalibrationStep[] = [
  {
    key: "chatgpt.inputAnchor",
    title: "校准 1/7：ChatGPT 输入框锚点",
    detail: "把鼠标移动到左侧 ChatGPT 输入框中心，然后点击 Capture。"
  },
  {
    key: "chatgpt.sendButtonAnchor",
    title: "校准 2/7：ChatGPT 发送按钮锚点",
    detail: "把鼠标移动到左侧 ChatGPT 发送按钮中心，然后点击 Capture。"
  },
  {
    key: "chatgpt.scrollBottomAnchor",
    title: "校准 3/7：ChatGPT 回到底部按钮锚点",
    detail: "把鼠标移动到左侧 ChatGPT 向下箭头按钮中心，然后点击 Capture。"
  },
  {
    key: "chatgpt.copySearchAnchor",
    title: "校准 4/7：ChatGPT 底部 copy 搜索锚点",
    detail: "把鼠标移动到左侧最新回复下方工具条附近（copy 可能出现区域），然后点击 Capture。"
  },
  {
    key: "codex.inputAnchor",
    title: "校准 5/7：Codex 输入框锚点",
    detail: "把鼠标移动到右侧 Codex 输入框中心，然后点击 Capture。"
  },
  {
    key: "codex.hoverBandAnchor",
    title: "校准 6/7：Codex hover 候选带锚点",
    detail: "把鼠标移动到右侧最新回复底部操作条大概中点（输入框上方区域），然后点击 Capture。"
  },
  {
    key: "codex.copyCandidateAnchor",
    title: "校准 7/7：Codex copy 候选点组锚点",
    detail: "把鼠标移动到右侧 copy 按钮常见出现位置的中心点，然后点击 Capture。"
  }
];

export class CalibrationService {
  constructor(private readonly logger: Logger) {}

  isCalibrated(config: BridgeConfig): boolean {
    const { chatgpt, codex } = config.calibration;
    return Boolean(
      config.calibration.calibrated &&
        chatgpt.inputAnchor &&
        chatgpt.sendButtonAnchor &&
        chatgpt.scrollBottomAnchor &&
        chatgpt.copySearchAnchor &&
        codex.inputAnchor &&
        codex.hoverBandAnchor &&
        codex.copyCandidateAnchor
    );
  }

  async run(config: BridgeConfig): Promise<BridgeConfig | null> {
    const next = structuredClone(config);

    for (const step of CALIBRATION_STEPS) {
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
        this.logger.warn("calibration cancelled", { step: step.key });
        return null;
      }

      const point = screen.getCursorScreenPoint();
      this.setAnchor(next, step.key, point);
      this.logger.info("captured calibration anchor", {
        step: step.key,
        point
      });
    }

    this.deriveRois(next);
    next.calibration.calibrated = true;

    await dialog.showMessageBox({
      type: "info",
      title: "校准完成",
      message: "校准已完成并写入配置。",
      detail: "你现在可以使用 Start 热键启动循环。",
      buttons: ["OK"],
      defaultId: 0,
      noLink: true
    });

    return next;
  }

  private setAnchor(
    config: BridgeConfig,
    key: CalibrationStep["key"],
    point: Point
  ): void {
    if (key === "chatgpt.inputAnchor") {
      config.calibration.chatgpt.inputAnchor = point;
      return;
    }

    if (key === "chatgpt.sendButtonAnchor") {
      config.calibration.chatgpt.sendButtonAnchor = point;
      return;
    }

    if (key === "chatgpt.scrollBottomAnchor") {
      config.calibration.chatgpt.scrollBottomAnchor = point;
      return;
    }

    if (key === "chatgpt.copySearchAnchor") {
      config.calibration.chatgpt.copySearchAnchor = point;
      return;
    }

    if (key === "codex.inputAnchor") {
      config.calibration.codex.inputAnchor = point;
      return;
    }

    if (key === "codex.hoverBandAnchor") {
      config.calibration.codex.hoverBandAnchor = point;
      return;
    }

    config.calibration.codex.copyCandidateAnchor = point;
  }

  private deriveRois(config: BridgeConfig): void {
    const gptAnchor = config.calibration.chatgpt.copySearchAnchor;
    if (gptAnchor) {
      config.calibration.chatgpt.responseRoi = this.roiFromAnchor(gptAnchor, {
        x: -540,
        y: -280,
        width: 1080,
        height: 260
      });
    }

    const codexAnchor = config.calibration.codex.hoverBandAnchor;
    if (codexAnchor) {
      config.calibration.codex.responseRoi = this.roiFromAnchor(codexAnchor, {
        x: -560,
        y: -320,
        width: 1120,
        height: 300
      });
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
}
