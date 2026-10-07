// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DevPanel } from "@/app/capture/DevPanel";
import type { LoggedCaptureEvent } from "@/lib/capture/browser/event-log";

afterEach(() => cleanup());

function noop() {
  /* unused in the shell-only render test */
}

const BASE_PROPS = { onStart: noop, onPause: noop, onStop: noop, events: [] as LoggedCaptureEvent[] };

describe("DevPanel", () => {
  it("renders a labelled container", () => {
    const { container } = render(<DevPanel {...BASE_PROPS} />);
    const panel = container.querySelector('[data-testid="dev-panel"]');
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toMatch(/developer/i);
  });

  it('clicking "Start" calls onStart exactly once', () => {
    const onStart = vi.fn();
    render(<DevPanel {...BASE_PROPS} onStart={onStart} />);
    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('clicking "Pause" calls onPause exactly once', () => {
    const onPause = vi.fn();
    render(<DevPanel {...BASE_PROPS} onPause={onPause} />);
    fireEvent.click(screen.getByRole("button", { name: /pause/i }));
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it('clicking "Stop" calls onStop exactly once', () => {
    const onStop = vi.fn();
    render(<DevPanel {...BASE_PROPS} onStop={onStop} />);
    fireEvent.click(screen.getByRole("button", { name: /stop/i }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("renders nothing event-related from an empty list (no crash, no error placeholder)", () => {
    const { container } = render(<DevPanel {...BASE_PROPS} events={[]} />);
    expect(container.querySelector('[data-testid="dev-event-log"]')?.textContent).toBe(
      "",
    );
    expect(container.textContent).not.toMatch(/error/i);
  });

  it("renders a provided event list newest-first, each as a human-readable line", () => {
    const events: LoggedCaptureEvent[] = [
      { ts: 1_000, event: { type: "state_changed", state: "listening", queuedCount: 0 } },
      { ts: 2_000, event: { type: "segment_closed", seg_id: "seg-1", duration_ms: 1400 } },
    ];
    const { container } = render(<DevPanel {...BASE_PROPS} events={events} />);
    const log = container.querySelector('[data-testid="dev-event-log"]');
    const lines = Array.from(log?.querySelectorAll("li") ?? []).map((li) => li.textContent);
    expect(lines).toHaveLength(2);
    // Newest (segment_closed, ts 2000) first.
    expect(lines[0]).toMatch(/segment_closed/);
    expect(lines[0]).toMatch(/seg-1/);
    expect(lines[0]).toMatch(/1400/);
    expect(lines[1]).toMatch(/state_changed/);
  });

  // R-07 Task 8: new readouts, all via optional props with safe ("not shown")
  // defaults — the current page.tsx (unmodified, pre-P1) passes none of
  // these, so BASE_PROPS alone must keep rendering exactly as before.
  describe("R-07 readouts (optional props, safe defaults)", () => {
    it("renders no readout section when none of the new props are passed", () => {
      const { container } = render(<DevPanel {...BASE_PROPS} />);
      expect(container.querySelector('[data-testid="dev-readouts"]')).toBeNull();
    });

    it("shows the answer-cache pending count when provided", () => {
      const { container } = render(<DevPanel {...BASE_PROPS} answerCacheCount={3} />);
      const readouts = container.querySelector('[data-testid="dev-readouts"]');
      expect(readouts).not.toBeNull();
      expect(readouts?.textContent).toMatch(/3/);
    });

    it("shows the oldest-pending age in minutes when provided", () => {
      const { container } = render(
        <DevPanel {...BASE_PROPS} answerCacheCount={1} oldestPendingAgeMinutes={42} />,
      );
      expect(container.querySelector('[data-testid="dev-readouts"]')?.textContent).toMatch(/42/);
    });

    it("shows nothing cached when oldestPendingAgeMinutes is null", () => {
      const { container } = render(
        <DevPanel {...BASE_PROPS} answerCacheCount={0} oldestPendingAgeMinutes={null} />,
      );
      expect(container.querySelector('[data-testid="dev-readouts"]')?.textContent).not.toMatch(
        /\d+ min/,
      );
    });

    it('renders a "Purge now" button that calls onPurgeNow when provided', () => {
      const onPurgeNow = vi.fn();
      render(<DevPanel {...BASE_PROPS} answerCacheCount={2} onPurgeNow={onPurgeNow} />);
      fireEvent.click(screen.getByRole("button", { name: /purge now/i }));
      expect(onPurgeNow).toHaveBeenCalledTimes(1);
    });

    it('omits the "Purge now" button when onPurgeNow is not provided', () => {
      render(<DevPanel {...BASE_PROPS} answerCacheCount={2} />);
      expect(screen.queryByRole("button", { name: /purge now/i })).toBeNull();
    });

    it("shows the derived capture-mode label when provided", () => {
      const { container } = render(<DevPanel {...BASE_PROPS} captureMode="wearable" />);
      expect(container.querySelector('[data-testid="dev-readouts"]')?.textContent).toMatch(
        /wearable/i,
      );
    });

    it("shows exactly the caller-truncated device id, never a longer string", () => {
      const { container } = render(<DevPanel {...BASE_PROPS} deviceIdShort="ab12cd" />);
      const text = container.querySelector('[data-testid="dev-readouts"]')?.textContent ?? "";
      expect(text).toMatch(/ab12cd/);
      // DevPanel never appends to the id it was given (hard rule #7: it never
      // sees, and therefore can never leak, the rest of the device id).
      expect(text).not.toMatch(/ab12cd[0-9a-zA-Z]/);
    });
  });
});
