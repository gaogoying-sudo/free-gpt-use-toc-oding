import { app } from "electron";
import { BridgeRuntime } from "./runtime";

let runtime: BridgeRuntime | null = null;

const boot = async (): Promise<void> => {
  await app.whenReady();
  app.setName("mac-gpt-codex-bridge-v0");

  if (process.platform === "darwin") {
    app.dock?.hide();
  }

  runtime = await BridgeRuntime.bootstrap();
};

void boot();

app.on("will-quit", () => {
  runtime?.dispose().catch((error) => {
    console.error("dispose failed", error);
  });
});
