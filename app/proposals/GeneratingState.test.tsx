// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { GeneratingState } from "@/app/proposals/GeneratingState";
import { axeViolations } from "@/lib/testing/axe";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("GeneratingState (D2-03d)", () => {
  it("is a polite status with the asking title and the keep-this-page-open line", () => {
    render(<GeneratingState lang="en" />);
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Bee6 is writing a proposal");
    expect(status.textContent).toContain("This can take up to a minute. Please keep this page open.");
  });

  it("keeps exactly one live region; the amber orb beside the text is decoration (aria-hidden)", () => {
    const { container } = render(<GeneratingState lang="en" estimate={{ min_s: 10, max_s: 30 }} />);
    expect(container.querySelectorAll("[aria-live], [role='status'], [role='alert']")).toHaveLength(1);
    const stage = container.querySelector(".b6-stage--amber");
    expect(stage).not.toBeNull();
    expect(stage!.getAttribute("aria-hidden")).toBe("true");
    expect(stage!.closest("[role='status']")).not.toBeNull();
  });

  // Demo feedback 2 item 18: a chained ask names which proposal is being written; one round shows no such line.
  it("a chain of two or more rounds adds one 'Writing proposal n of total…' line inside the same single live region", () => {
    const { container } = render(<GeneratingState lang="en" round={{ n: 2, total: 3 }} />);
    expect(screen.getByRole("status").textContent).toContain("Writing proposal 2 of 3…");
    expect(container.querySelectorAll("[aria-live], [role='status'], [role='alert']")).toHaveLength(1);
  });

  it.each([[null], [undefined], [{ n: 1, total: 1 }]])("no round line for %j", (round) => {
    render(<GeneratingState lang="en" round={round} />);
    expect(screen.getByRole("status").textContent).not.toMatch(/Writing proposal/);
  });

  it("the round line has an ID version and the page has no axe violations", async () => {
    const { container } = render(<GeneratingState lang="id" round={{ n: 1, total: 2 }} />);
    expect(screen.getByRole("status").textContent).toContain("Menulis usulan 1 dari 2…");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("ID copy", () => {
    render(<GeneratingState lang="id" />);
    expect(screen.getByText("Bee6 sedang menulis usulan")).not.toBeNull();
  });

  // Integration QA D2: the block stands in for the proposal list; it keeps at least that list's height so nothing
  // below it (the constraints panel) is pulled up while Bee6 works and pushed back down when the rows return.
  it("reserves the height of the list it replaces; nothing is reserved without one", () => {
    const { unmount } = render(<GeneratingState lang="en" minHeight={420} />);
    expect(screen.getByRole("status").style.minHeight).toBe("420px");
    unmount();
    render(<GeneratingState lang="en" />);
    expect(screen.getByRole("status").style.minHeight).toBe("");
  });
});

// R-24 D11 (plan 3.11): the estimated wait, shown only while the v4 flag is on (the prop is `null` otherwise).
describe("GeneratingState — estimated wait (R-24 D11)", () => {
  const ESTIMATE = { min_s: 10, max_s: 30 } as const;

  it("flag off: no estimate and null render the same markup as today, with the unchanged body line", () => {
    const { container, unmount } = render(<GeneratingState lang="en" minHeight={420} />);
    const today = container.innerHTML;
    expect(today).toContain("This can take up to a minute. Please keep this page open.");
    unmount();
    const withNull = render(<GeneratingState lang="en" minHeight={420} estimate={null} />);
    expect(withNull.container.innerHTML).toBe(today);
    withNull.unmount();
    const withUndefined = render(<GeneratingState lang="en" minHeight={420} estimate={undefined} />);
    expect(withUndefined.container.innerHTML).toBe(today);
  });

  it("flag off never starts a timer", () => {
    vi.useFakeTimers();
    render(<GeneratingState lang="en" estimate={null} />);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("says it writes AND checks each proposal, the usual range and the honest ceiling, and is still one polite status", () => {
    vi.useFakeTimers();
    render(<GeneratingState lang="en" estimate={ESTIMATE} />);
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toContain("Bee6 is writing a proposal");
    expect(status.textContent).toContain("Bee6 is writing and checking each proposal.");
    expect(status.textContent).toContain("Usually 10–30 seconds, sometimes up to a minute.");
    expect(status.textContent).toContain("Keep this page open.");
    // The flag-off body line is not the one shown.
    expect(status.textContent).not.toContain("This can take up to a minute. Please keep this page open.");
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("switches once to the overrun line at max_s; still exactly one status; no counter in between", () => {
    vi.useFakeTimers();
    render(<GeneratingState lang="en" estimate={ESTIMATE} />);
    const before = screen.getByRole("status").textContent;
    act(() => {
      vi.advanceTimersByTime(29_999);
    });
    expect(screen.getByRole("status").textContent).toContain("Usually 10–30 seconds");
    expect(screen.getByRole("status").textContent).not.toContain("Taking longer than usual");
    // Nothing re-renders between the start and max_s: the text a screen reader heard is the text it still has.
    expect(screen.getByRole("status").textContent).toBe(before);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Taking longer than usual. Bee6 is still working. Keep this page open.");
    expect(status.textContent).not.toContain("Usually");
    expect(screen.getAllByRole("status")).toHaveLength(1);
    // It stays there, well past the range, until the server answers; no timer is left running.
    act(() => {
      vi.advanceTimersByTime(200_000);
    });
    expect(screen.getByRole("status").textContent).toContain("Taking longer than usual");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("has no progress bar and no ticking number", () => {
    vi.useFakeTimers();
    const { container } = render(<GeneratingState lang="en" estimate={ESTIMATE} />);
    expect(container.querySelector("[role='progressbar'], progress, meter")).toBeNull();
    const textOf = () => screen.getByRole("status").textContent;
    const first = textOf();
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(textOf()).toBe(first);
  });

  it("ID copy", () => {
    vi.useFakeTimers();
    render(<GeneratingState lang="id" estimate={ESTIMATE} />);
    expect(screen.getByRole("status").textContent).toContain("Bee6 menulis dan memeriksa setiap usulan.");
    expect(screen.getByRole("status").textContent).toContain("Biasanya 10–30 detik, kadang sampai satu menit.");
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByRole("status").textContent).toContain("Lebih lama dari biasanya. Bee6 masih bekerja.");
  });

  it("unmounting before max_s clears the timer and warns about nothing", () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = render(<GeneratingState lang="en" estimate={ESTIMATE} />);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(error).not.toHaveBeenCalled();
  });

  it("an estimate removed while mounted goes back to today's body line, and does not come back stale", () => {
    vi.useFakeTimers();
    const { rerender } = render(<GeneratingState lang="en" estimate={ESTIMATE} />);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    rerender(<GeneratingState lang="en" estimate={null} />);
    expect(screen.getByRole("status").textContent).toContain("This can take up to a minute.");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the reserved height while the body line changes", () => {
    vi.useFakeTimers();
    render(<GeneratingState lang="en" minHeight={420} estimate={ESTIMATE} />);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByRole("status").style.minHeight).toBe("420px");
  });
});

// CHK-1 follow-up: the overrun timer is per round. A chained Ask (item 18) keeps this block mounted across its rounds, so
// each round must restart the estimate, or a two-round v4 Ask shows "Taking longer than usual" on most Asks.
describe("GeneratingState: the overrun timer restarts with each round", () => {
  const ESTIMATE = { min_s: 10, max_s: 30 } as const;
  const text = () => screen.getByRole("status").textContent ?? "";

  it("a round that starts at 12 s shows no overrun at 25 s (37 s in), and the overrun 30 s after the round began", () => {
    vi.useFakeTimers();
    const { rerender } = render(<GeneratingState lang="en" estimate={ESTIMATE} round={{ n: 1, total: 2 }} />);
    act(() => {
      vi.advanceTimersByTime(12_000);
    });
    rerender(<GeneratingState lang="en" estimate={ESTIMATE} round={{ n: 2, total: 2 }} />);
    act(() => {
      vi.advanceTimersByTime(25_000);
    });
    expect(text()).toContain("Usually 10–30 seconds");
    expect(text()).not.toContain("Taking longer than usual");
    act(() => {
      vi.advanceTimersByTime(4_999);
    });
    expect(text()).not.toContain("Taking longer than usual");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(text()).toContain("Taking longer than usual");
    expect(text()).toContain("Writing proposal 2 of 2…");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a new round after the overrun line was shown goes back to the usual range", () => {
    vi.useFakeTimers();
    const { rerender } = render(<GeneratingState lang="en" estimate={ESTIMATE} round={{ n: 1, total: 2 }} />);
    act(() => {
      vi.advanceTimersByTime(31_000);
    });
    expect(text()).toContain("Taking longer than usual");
    rerender(<GeneratingState lang="en" estimate={ESTIMATE} round={{ n: 2, total: 2 }} />);
    expect(text()).toContain("Usually 10–30 seconds");
    expect(text()).not.toContain("Taking longer than usual");
  });

  it("a re-render with the same round keeps the running timer (no restart)", () => {
    vi.useFakeTimers();
    const { rerender } = render(<GeneratingState lang="en" estimate={ESTIMATE} round={{ n: 1, total: 2 }} />);
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    rerender(<GeneratingState lang="en" estimate={ESTIMATE} round={{ n: 1, total: 2 }} minHeight={300} />);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(text()).toContain("Taking longer than usual");
  });

  it("the single live region survives the round change (same node), so the new round line is still announced", () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<GeneratingState lang="en" estimate={ESTIMATE} round={{ n: 1, total: 3 }} />);
    const region = screen.getByRole("status");
    rerender(<GeneratingState lang="en" estimate={ESTIMATE} round={{ n: 2, total: 3 }} />);
    expect(screen.getByRole("status")).toBe(region);
    expect(container.querySelectorAll("[aria-live], [role='status'], [role='alert']")).toHaveLength(1);
    expect(region.textContent).toContain("Writing proposal 2 of 3…");
    expect(region.textContent).not.toContain("Writing proposal 1 of 3…");
  });

  it("has no axe violations on either side of a round change", async () => {
    // Real timers: axe schedules its own work with setTimeout. The 30 s estimate timer is cleared when the test unmounts.
    const { container, rerender } = render(<GeneratingState lang="en" estimate={ESTIMATE} round={{ n: 1, total: 2 }} />);
    expect(await axeViolations(container)).toEqual([]);
    rerender(<GeneratingState lang="id" estimate={ESTIMATE} round={{ n: 2, total: 2 }} />);
    expect(await axeViolations(container)).toEqual([]);
  });
});
