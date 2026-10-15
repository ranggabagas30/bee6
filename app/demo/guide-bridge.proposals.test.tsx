// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { PROPOSALS_PROGRESS_EVENT, PROPOSALS_SCREEN_EVENT, publishProposalsProgress, publishProposalsScreen } from "@/lib/demo/proposals-signal";
import { useProposalsSignal } from "@/app/demo/guide-bridge";

/**
 * R-19 after-merge wiring: the guide reads the proposals page's screen and progress signal (lib/demo/proposals-signal)
 * through one hook, the way it reads the debrief's view (`useDebriefView`): re-read the moment the page publishes, no
 * timer, no poll; null and a still counter when no proposals page is mounted.
 */

afterEach(() => {
  cleanup();
  publishProposalsScreen(null);
});

describe("useProposalsSignal", () => {
  it("is empty until the page publishes, then follows every screen change and every progress bump at once", () => {
    const { result } = renderHook(() => useProposalsSignal());
    expect(result.current.screen).toBeNull();
    const v0 = result.current.progressVersion;
    act(() => publishProposalsScreen("generating"));
    expect(result.current.screen).toBe("generating");
    expect(result.current.progressVersion).toBe(v0);
    act(() => publishProposalsProgress());
    expect(result.current.progressVersion).toBe(v0 + 1);
    expect(result.current.screen).toBe("generating");
    act(() => publishProposalsScreen(null));
    expect(result.current.screen).toBeNull();
  });

  it("returns the same object while nothing changed (a stable snapshot for useSyncExternalStore)", () => {
    const { result, rerender } = renderHook(() => useProposalsSignal());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
    act(() => publishProposalsScreen("review"));
    expect(result.current).not.toBe(first);
  });

  it("stops listening on unmount", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useProposalsSignal());
    const added = add.mock.calls.map((c) => c[0]);
    expect(added).toContain(PROPOSALS_SCREEN_EVENT);
    expect(added).toContain(PROPOSALS_PROGRESS_EVENT);
    unmount();
    const removed = remove.mock.calls.map((c) => c[0]);
    expect(removed).toContain(PROPOSALS_SCREEN_EVENT);
    expect(removed).toContain(PROPOSALS_PROGRESS_EVENT);
    add.mockRestore();
    remove.mockRestore();
  });
});
