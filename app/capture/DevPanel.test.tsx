// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DevPanel } from "@/app/capture/DevPanel";

afterEach(() => cleanup());

function noop() {
  /* unused in the shell-only render test */
}

describe("DevPanel", () => {
  it("renders a labelled container", () => {
    const { container } = render(
      <DevPanel onStart={noop} onPause={noop} onStop={noop} />,
    );
    const panel = container.querySelector('[data-testid="dev-panel"]');
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toMatch(/developer/i);
  });

  it('clicking "Start" calls onStart exactly once', () => {
    const onStart = vi.fn();
    render(<DevPanel onStart={onStart} onPause={noop} onStop={noop} />);
    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('clicking "Pause" calls onPause exactly once', () => {
    const onPause = vi.fn();
    render(<DevPanel onStart={noop} onPause={onPause} onStop={noop} />);
    fireEvent.click(screen.getByRole("button", { name: /pause/i }));
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it('clicking "Stop" calls onStop exactly once', () => {
    const onStop = vi.fn();
    render(<DevPanel onStart={noop} onPause={noop} onStop={onStop} />);
    fireEvent.click(screen.getByRole("button", { name: /stop/i }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});
