import { app } from "electron";
import { BridgeRuntime } from "./runtime";

let runtime: BridgeRuntime | null = null;
let disposed = false;

const resolveDiagnosticArgs = (): { command: string; args: string[] } | null => {
  const index = process.argv.indexOf("--diag");
  if (index < 0) {
    return null;
  }

  return {
    command: process.argv[index + 1] ?? "help",
    args: process.argv.slice(index + 2)
  };
};

const boot = async (): Promise<void> => {
  await app.whenReady();
  app.setName("mac-gpt-codex-bridge-v0");
  const diag = resolveDiagnosticArgs();

  if (process.platform === "darwin") {
    app.dock?.hide();
  }

  runtime = await BridgeRuntime.bootstrap({
    mode: diag ? "diag" : "app"
  });

  if (diag) {
    const exitCode = await runtime.runDiagnostic(diag.command, diag.args);
    disposed = true;
    await runtime.dispose();
    app.exit(exitCode);
  }
};

void boot();

app.on("will-quit", () => {
  if (disposed) {
    return;
  }
  runtime?.dispose().catch((error) => {
    console.error("dispose failed", error);
  });
});
