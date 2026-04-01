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

## 说明

- V0 仅面向当前机器固定布局。
- 不使用 OCR 作为主路径。
- 坐标通过首次校准写入本地配置，不在代码中硬编码绝对坐标。
