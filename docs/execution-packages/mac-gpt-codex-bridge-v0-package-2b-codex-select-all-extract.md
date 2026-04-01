# Mac GPT ↔ Codex Bridge V0 - Package 2B (Codex Select-All Extract)

## Scope

本包对 Package 2 做方向修正：
- 右侧 Codex 主抓取链路从 `hover reveal copy` 切换为 `select-all-copy-extract`
- 左侧 ChatGPT 保持原方案不动
- 右侧人工多点校准降级，不再作为主依赖
- 增加 transcript parser，用于从整段文本中裁剪“最新一轮 Codex 回复”

## Right-Side Main Flow

1. focus VSCode
2. ensure Codex pane active
3. wait output completion (ROI stability + input re-ready)
4. `Esc` 退出输入框焦点
5. 点击正文激活点（由 window bounds + ratio 推导）
6. `Cmd + A`
7. `Cmd + C`
8. 读取剪贴板全文
9. parse latest reply (prompt boundary → noise trim → fallback block)
10. validate extracted reply

## Calibration Change

右侧最小化为：
- `codex.inputAnchor`（用于发送时输入框聚焦）

其他右侧交互位置通过窗口比例自动推导，不再依赖：
- `paneActivationPoint`
- `replyAreaActivationPoint`
- `hoverBandAnchor`
- `copyCandidatePoints`

## Parser Rules

`codex-transcript-parser.ts` 裁剪顺序：
1. 主边界：`lastSentToCodexRaw` 最后一次出现位置切割
2. 指纹边界：prompt 头/尾 fingerprint 匹配切割
3. 尾部清理：清除明显 UI 噪音行
4. fallback：从底部向上选择最近可用正文块
5. 校验：非空、最小长度、非 prompt 回声、非重复 hash

## Step Codes

新增：
- `CODEX_BODY_ACTIVATION_FAILED`
- `CODEX_SELECT_ALL_FAILED`
- `CODEX_COPY_FULL_TRANSCRIPT_FAILED`
- `CODEX_CLIPBOARD_EMPTY`
- `CODEX_TRANSCRIPT_PARSE_FAILED`
- `CODEX_EXTRACTED_REPLY_INVALID`

保留：
- `VSCODE_WINDOW_FOCUS_FAILED`
- `CODEX_SCROLL_BOTTOM_FAILED`
- 以及左侧 ChatGPT 相关 step codes

## Diagnostic Commands

```bash
cd apps/desktop
npm run diag -- check-permissions
npm run diag -- print-calibration
npm run diag -- right-activate-body
npm run diag -- right-select-all
npm run diag -- right-copy-full-transcript
npm run diag -- right-extract-latest "optional last prompt"
npm run diag -- round-gpt-to-codex
```

## Real-Machine Short Guide

1. `check-permissions`
2. `print-calibration`（右侧至少要有 `codex.inputAnchor`）
3. 缺失时菜单栏执行 `Recalibrate Right (Codex)`
4. `right-activate-body`
5. `right-select-all`
6. `right-copy-full-transcript`
7. `right-extract-latest`
8. `round-gpt-to-codex` 后再启动菜单栏循环
