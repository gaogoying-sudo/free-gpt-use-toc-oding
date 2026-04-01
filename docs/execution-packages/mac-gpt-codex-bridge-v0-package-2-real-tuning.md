# Mac GPT ↔ Codex Bridge V0 - Package 2 (Real Tuning)

## Scope

本包聚焦：
- 实机标定与阈值打磨
- Codex 右侧 focus-before-hover copy 链路强化
- 最小诊断命令与权限自检
- 基础单步回放

本包不包含：异常恢复矩阵、OCR 兜底、产品化 UI、打包发布。

## Codex Copy Flow (Focus-Before-Hover)

右侧 copy 链路固定顺序：
1. `focus VSCode window`
2. `activate Codex pane`
3. `scroll to bottom`
4. `hover band`
5. `click copy candidate`
6. `clipboard verify`
7. 若失败：`activate reply area`
8. `hover again`
9. `click next candidate`
10. `clipboard verify`
11. 若仍失败：进入明确 step code 报错

## New Calibration Points

### Left (ChatGPT)
- `inputAnchor`
- `sendButtonAnchor`
- `scrollBottomAnchor`
- `copySearchAnchor`
- `latestReplyStableRoi`

### Right (Codex)
- `inputAnchor`
- `paneActivationPoint`
- `replyAreaActivationPoint`
- `hoverBandAnchor`
- `copyCandidatePoints` (3 points)
- `stableRoi`
- `bottomAnchor`
- `bottomDetectionRoi`

支持重跑策略：
- 全量重跑：left + right
- 仅重跑右侧：`Recalibrate Right (Codex)`

## Tunable Config Parameters

在 `config.json` 可调：
- `timing.hoverDwellMs`
- `timing.postActivationSettleMs`
- `timing.postScrollSettleMs`
- `timing.postHoverSettleMs`
- `timing.clipboardVerifyTimeoutMs`
- `timing.roiStabilityWindowMs`
- `screenProbe.roiPixelDiffThreshold`
- `retries.maxHoverAttempts`
- `retries.maxCopyAttempts`
- `retries.maxActivationAttempts`

## Step Codes

- `VSCODE_WINDOW_FOCUS_FAILED`
- `CODEX_PANE_ACTIVATION_FAILED`
- `CODEX_REPLY_AREA_ACTIVATION_FAILED`
- `CODEX_SCROLL_BOTTOM_FAILED`
- `CODEX_HOVER_REVEAL_FAILED`
- `CODEX_COPY_CLICK_FAILED`
- `CODEX_CLIPBOARD_NOT_CHANGED`
- `CHATGPT_SEND_NOT_CONFIRMED`
- `CHATGPT_OUTPUT_NOT_STABLE`
- `CHATGPT_COPY_FAILED`

## Minimal Diagnostics Commands

```bash
cd apps/desktop
npm run diag -- print-calibration
npm run diag -- check-permissions
npm run diag -- left-send "diag message"
npm run diag -- left-copy
npm run diag -- right-pane-activation
npm run diag -- right-hover-reveal
npm run diag -- right-copy
npm run diag -- round-gpt-to-codex
npm run diag -- round-codex-to-gpt
```

## Real-Machine Debug Playbook

推荐顺序：
1. `npm run diag -- check-permissions`
2. `npm run diag -- print-calibration`
3. 菜单栏执行 `Recalibrate Right (Codex)`（如右侧点位缺失）
4. `npm run diag -- right-pane-activation`
5. `npm run diag -- right-hover-reveal`
6. `npm run diag -- right-copy`
7. 再跑 `npm run diag -- round-gpt-to-codex`
8. 最后启动主循环做完整往返手测

判错方法：
- 先看终端 `stepCode=...`
- 再看 `bridge.log` 中同名 step code 日志
- 对应修正：
  - `VSCODE_WINDOW_FOCUS_FAILED`：检查窗口前置和 app 名
  - `CODEX_PANE_ACTIVATION_FAILED`：重标 pane 激活点
  - `CODEX_REPLY_AREA_ACTIVATION_FAILED`：重标回复区激活点
  - `CODEX_SCROLL_BOTTOM_FAILED`：重标 bottomAnchor / bottomDetectionRoi
  - `CODEX_HOVER_REVEAL_FAILED`：调 `hoverDwellMs` 与 hover 点位
  - `CODEX_COPY_CLICK_FAILED`：重标 copyCandidatePoints
  - `CODEX_CLIPBOARD_NOT_CHANGED`：增大 `clipboardVerifyTimeoutMs` / 调整 copy 候选点

## Notes

- 本包面向当前固定分屏布局，不追求通用化。
- 未引入 OCR 与外部模型。
