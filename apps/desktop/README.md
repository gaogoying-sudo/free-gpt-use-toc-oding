# Mac GPT ↔ Codex Bridge V0

本目录是 V0 本机自动桥接器（Electron + TypeScript）实现。

## 快速启动

```bash
cd apps/desktop
npm install
npm run start
```

首次启动会要求进行校准，结果保存在用户目录下：

- 配置：`~/Library/Application Support/mac-gpt-codex-bridge-v0/config.json`
- 日志：`~/Library/Application Support/mac-gpt-codex-bridge-v0/logs/bridge.log`

## 默认热键（可在 config.json 改）

- Start / Resume: `Command+Option+Control+S`
- Stop: `Command+Option+Control+X`
- Recalibrate: `Command+Option+Control+K`

菜单栏也支持：
- `Recalibrate Right (Codex)`：仅重跑右侧校准
- `Print Calibration Status`：打印左右点位与阈值配置

## 诊断命令

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

## 说明

- V0 仅面向当前机器固定布局。
- 不使用 OCR 作为主路径。
- 坐标通过首次校准写入本地配置，不在代码中硬编码绝对坐标。
