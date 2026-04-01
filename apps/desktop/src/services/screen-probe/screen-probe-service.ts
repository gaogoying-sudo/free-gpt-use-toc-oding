import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { BridgeConfig } from "../../types/config";
import { Rect, clampRect } from "../../types/geometry";
import { Logger } from "../logger/logger";
import { sleep, throwIfAborted } from "../utils";
import { runCommand } from "../automation/command-runner";

export interface StabilityRequest {
  roi: Rect;
  timeoutMs: number;
  stableWindowMs: number;
  pollIntervalMs: number;
  maxDeltaRatio: number;
  signal?: AbortSignal;
}

export interface ChangeRequest {
  roi: Rect;
  timeoutMs: number;
  pollIntervalMs: number;
  minDeltaRatio: number;
  signal?: AbortSignal;
}

interface Frame {
  width: number;
  height: number;
  data: Buffer;
}

export class ScreenProbeService {
  constructor(
    private readonly getConfig: () => BridgeConfig,
    private readonly logger: Logger
  ) {}

  async waitForStability(request: StabilityRequest): Promise<boolean> {
    if (this.getConfig().debug.mockAutomation) {
      await sleep(Math.min(800, request.stableWindowMs), request.signal);
      return true;
    }

    const start = Date.now();
    let previous: Frame | null = null;
    let stableSince: number | null = null;

    while (Date.now() - start <= request.timeoutMs) {
      throwIfAborted(request.signal);

      const current = await this.captureFrame(request.roi);
      if (previous) {
        const delta = this.deltaRatio(previous, current);
        this.logger.debug("stability probe sample", {
          delta,
          threshold: request.maxDeltaRatio
        });

        if (delta <= request.maxDeltaRatio) {
          stableSince = stableSince ?? Date.now();
          if (Date.now() - stableSince >= request.stableWindowMs) {
            return true;
          }
        } else {
          stableSince = null;
        }
      }

      previous = current;
      await sleep(request.pollIntervalMs, request.signal);
    }

    return false;
  }

  async detectChange(request: ChangeRequest): Promise<boolean> {
    if (this.getConfig().debug.mockAutomation) {
      await sleep(Math.min(400, request.pollIntervalMs), request.signal);
      return true;
    }

    const start = Date.now();
    let previous: Frame | null = null;

    while (Date.now() - start <= request.timeoutMs) {
      throwIfAborted(request.signal);

      const current = await this.captureFrame(request.roi);
      if (previous) {
        const delta = this.deltaRatio(previous, current);
        this.logger.debug("change probe sample", {
          delta,
          threshold: request.minDeltaRatio
        });

        if (delta >= request.minDeltaRatio) {
          return true;
        }
      }

      previous = current;
      await sleep(request.pollIntervalMs, request.signal);
    }

    return false;
  }

  private async captureFrame(roi: Rect): Promise<Frame> {
    if (this.getConfig().debug.mockAutomation) {
      return {
        width: 2,
        height: 2,
        data: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])
      };
    }

    const normalized = clampRect(roi);
    const imagePath = path.join(
      os.tmpdir(),
      `bridge-probe-${Date.now()}-${Math.random().toString(16).slice(2)}.png`
    );

    const rect = `${normalized.x},${normalized.y},${normalized.width},${normalized.height}`;
    await runCommand("/usr/sbin/screencapture", ["-x", `-R${rect}`, imagePath], 10_000);

    try {
      const raw = await fs.readFile(imagePath);
      const png = PNG.sync.read(raw);
      return {
        width: png.width,
        height: png.height,
        data: png.data
      };
    } finally {
      await fs.rm(imagePath, { force: true });
    }
  }

  private deltaRatio(prev: Frame, next: Frame): number {
    if (prev.width !== next.width || prev.height !== next.height) {
      return 1;
    }

    let delta = 0;
    const size = Math.min(prev.data.length, next.data.length);

    for (let i = 0; i < size; i += 4) {
      delta += Math.abs(prev.data[i] - next.data[i]);
      delta += Math.abs(prev.data[i + 1] - next.data[i + 1]);
      delta += Math.abs(prev.data[i + 2] - next.data[i + 2]);
    }

    const pixels = prev.width * prev.height;
    const maxDelta = pixels * 255 * 3;
    return maxDelta === 0 ? 0 : delta / maxDelta;
  }
}
