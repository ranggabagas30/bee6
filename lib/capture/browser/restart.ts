import { backoffDelayMs } from "@/lib/capture/retry";

/**
 * Mic-error self-restart controller (web spec §5: "the page re-requests the mic
 * and restarts itself after errors or device changes"). Pure: tracks the current
 * restart attempt and returns the next backoff delay; `reset()` on a clean run.
 * Reuses the capture backoff so restart and upload retry behave consistently.
 */
export class RestartController {
  private attempt = 0;

  constructor(
    private readonly opts: { baseMs?: number; maxMs?: number } = {},
  ) {}

  get attempts(): number {
    return this.attempt;
  }

  /** Advances the attempt counter and returns the delay before the next try. */
  nextDelayMs(): number {
    this.attempt += 1;
    return backoffDelayMs(this.attempt, {
      jitter: false,
      baseMs: this.opts.baseMs ?? 500,
      maxMs: this.opts.maxMs ?? 10_000,
    });
  }

  /** Resets after a successful (re)start. */
  reset(): void {
    this.attempt = 0;
  }
}
