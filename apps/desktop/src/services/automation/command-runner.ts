import { execFile } from "node:child_process";

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export const runCommand = (
  cmd: string,
  args: string[] = [],
  timeoutMs = 15_000
): Promise<CommandResult> =>
  new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      {
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`${cmd} ${args.join(" ")} failed: ${error.message} ${stderr}`));
          return;
        }

        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim()
        });
      }
    );
  });
