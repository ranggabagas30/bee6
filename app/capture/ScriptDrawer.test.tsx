// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ScriptDrawer, type ScriptDrawerProps } from "@/app/capture/ScriptDrawer";

afterEach(() => cleanup());

const STARTED = 1_800_000_000_000;
function props(over: Partial<ScriptDrawerProps> = {}): ScriptDrawerProps {
  return {
    scriptId: "bakery-v1",
    lang: "en",
    state: "running",
    startedAtMs: STARTED,
    maxMs: 300_000,
    nowMs: STARTED + 60_000,
    onFinish: vi.fn(),
    finishing: false,
    open: true,
    onToggle: vi.fn(),
    wide: false,
    reducedMotion: false,
    ...over,
  };
}
const region = () => screen.getByRole("region", { name: "Demo script" });
const next = () => screen.getByRole("button", { name: "Next" });

describe("ScriptDrawer (R-18)", () => {
  it("before: the rules card and the Tap Start line; no Next, no countdown", () => {
    render(<ScriptDrawer {...props({ state: "before", startedAtMs: null, nowMs: null })} />);
    expect(within(region()).getByText(/Read each card aloud/)).toBeTruthy();
    expect(within(region()).getByText("Tap Start to begin. Nothing is recorded until you do.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    expect(screen.queryByText(/Demo ends automatically/)).toBeNull();
  });

  it("running: the first card after the rules, with the general rules line in the header", () => {
    render(<ScriptDrawer {...props()} />);
    expect(within(region()).getByText(/first tray of croissants/)).toBeTruthy();
    expect(within(region()).getByText("Keep this tab open and the screen on. Allow the microphone. Plug in if the battery is low.")).toBeTruthy();
  });

  it("9.T2 Next and Back stay within bounds: Back is disabled on card 1, Next is replaced by Finish on the last card", () => {
    render(<ScriptDrawer {...props()} />);
    expect((screen.getByRole("button", { name: "Back" }) as HTMLButtonElement).disabled).toBe(true);
    for (let i = 0; i < 9; i += 1) fireEvent.click(next());
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    expect(screen.getByRole("button", { name: "Finish and end the day" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: "Next" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Finish and end the day" })).toBeNull();
  });

  it("9.T3 one polite live region announces 'Card n of N' on every change", () => {
    render(<ScriptDrawer {...props()} />);
    const live = screen.getByText("Card 1 of 10");
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.getAttribute("role")).toBe("status");
    fireEvent.click(next());
    expect(live.textContent).toBe("Card 2 of 10");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(live.textContent).toBe("Card 1 of 10");
  });

  it("item 10: the live region is mounted (empty) before Start, so 'Card 1 of 10' is announced when it fills", () => {
    const { rerender } = render(<ScriptDrawer {...props({ state: "before", startedAtMs: null, nowMs: null })} />);
    const live = screen.getByRole("status");
    expect(live.textContent).toBe("");
    expect(live.getAttribute("aria-live")).toBe("polite");
    rerender(<ScriptDrawer {...props()} />);
    expect(screen.getByRole("status")).toBe(live); // the same element: it was mounted before its content
    expect(live.textContent).toBe("Card 1 of 10");
  });

  it("an own-words card shows its example and a say card names the speaker", () => {
    render(<ScriptDrawer {...props()} />);
    fireEvent.click(next()); // bake-time-customer
    expect(within(region()).getByText(/In your own words/)).toBeTruthy();
    expect(within(region()).getByText("Example")).toBeTruthy();
    expect(within(region()).getByText(/When was this sourdough baked/)).toBeTruthy();
    fireEvent.click(next()); // bake-time-colleague
    expect(within(region()).getByText(/Colleague/)).toBeTruthy();
  });

  it("every card carries its 'what the app should notice' intent line and suggested seconds", () => {
    render(<ScriptDrawer {...props()} />);
    expect(within(region()).getByText("What the app should notice")).toBeTruthy();
    expect(within(region()).getByText("Opening routine: may become a fact on its own.")).toBeTruthy();
    expect(within(region()).getByText("About 15 s")).toBeTruthy();
  });

  it("follows the page language: Bahasa text and chrome", () => {
    render(<ScriptDrawer {...props({ lang: "id" })} />);
    expect(screen.getByRole("region", { name: "Skrip demo" })).toBeTruthy();
    expect(screen.getByText("Kartu 1 dari 10")).toBeTruthy();
    expect(screen.getByText(/Pagi\. Oven sudah nyala/)).toBeTruthy();
  });

  it("the countdown is text: remaining time, never below 0:00", () => {
    const { rerender } = render(<ScriptDrawer {...props({ nowMs: STARTED + 60_000 })} />);
    expect(screen.getByText("Demo ends automatically in 4:00")).toBeTruthy();
    rerender(<ScriptDrawer {...props({ nowMs: STARTED + 299_500 })} />);
    expect(screen.getByText("Demo ends automatically in 0:01")).toBeTruthy();
    rerender(<ScriptDrawer {...props({ nowMs: STARTED + 400_000 })} />);
    expect(screen.getByText("Demo ends automatically in 0:00")).toBeTruthy();
  });

  it("9.T4 Finish calls the handler; it is disabled while finishing", () => {
    const onFinish = vi.fn();
    const { rerender } = render(<ScriptDrawer {...props({ onFinish })} />);
    for (let i = 0; i < 9; i += 1) fireEvent.click(next());
    fireEvent.click(screen.getByRole("button", { name: "Finish and end the day" }));
    expect(onFinish).toHaveBeenCalledTimes(1);
    rerender(<ScriptDrawer {...props({ onFinish, finishing: true })} />);
    const busy = screen.getByRole("button", { name: "Finishing…" }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    fireEvent.click(busy);
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("9.T6 when the session ends by itself the drawer shows the ended text: no cards, no Finish, no countdown", () => {
    const { rerender } = render(<ScriptDrawer {...props()} />);
    fireEvent.click(next());
    rerender(<ScriptDrawer {...props({ state: "ended" })} />);
    expect(screen.getByText("Done. Answer the debrief questions, then switch to Supervisor.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Finish and end the day" })).toBeNull();
    expect(screen.queryByText(/Demo ends automatically/)).toBeNull();
  });

  it("a new session starts again at card 1 (key by state change)", () => {
    const { rerender } = render(<ScriptDrawer {...props({ state: "before", startedAtMs: null, nowMs: null })} />);
    rerender(<ScriptDrawer {...props()} />);
    fireEvent.click(next());
    fireEvent.click(next());
    expect(screen.getByText("Card 3 of 10")).toBeTruthy();
    rerender(<ScriptDrawer {...props({ state: "before", startedAtMs: null, nowMs: null })} />);
    rerender(<ScriptDrawer {...props()} />);
    expect(screen.getByText("Card 1 of 10")).toBeTruthy();
  });

  it("collapse button reports aria-expanded; collapsed hides the cards from the accessibility tree", () => {
    const onToggle = vi.fn();
    const { rerender } = render(<ScriptDrawer {...props({ onToggle })} />);
    const toggle = screen.getByRole("button", { name: "Hide script" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(<ScriptDrawer {...props({ onToggle, open: false })} />);
    const shown = screen.getByRole("button", { name: "Show script" });
    expect(shown.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    // the live region and the countdown stay available while collapsed
    expect(screen.getByText("Card 1 of 10")).toBeTruthy();
  });

  it("never traps focus: not a dialog, not modal, and nothing outside it is made inert or hidden", () => {
    const { container } = render(
      <>
        <button type="button">End</button>
        <ScriptDrawer {...props()} />
      </>,
    );
    expect(container.querySelector("[aria-modal]")).toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(screen.getByRole("button", { name: "End" })).toBeTruthy();
    expect(container.querySelector("[inert]")).toBeNull();
  });

  it("layout: in flow under 900 px (nothing fixed, so it can never cover End or Cancel), a fixed 360 px side panel from 900 px", () => {
    const { rerender } = render(<ScriptDrawer {...props({ wide: false })} />);
    expect(region().style.position).not.toBe("fixed");
    expect(region().style.bottom).toBe("");
    expect(region().style.maxHeight).not.toBe("");
    rerender(<ScriptDrawer {...props({ wide: false, open: false })} />);
    expect(region().style.height).toBe(""); // the collapsed handle takes the height of its own content
    expect(region().style.maxHeight).toBe("");
    rerender(<ScriptDrawer {...props({ wide: true })} />);
    expect(region().style.position).toBe("fixed");
    expect(region().style.right).toBe("0px");
    expect(region().style.width).toBe("360px");
    rerender(<ScriptDrawer {...props({ wide: true, open: false })} />);
    expect(region().style.height).toBe("");
  });

  it("the handle is ONE row: title, the card count and the short countdown share a line, with a 48 px toggle beside it", () => {
    render(<ScriptDrawer {...props()} />);
    const title = within(region()).getByRole("heading", { name: "Demo script" });
    const count = within(region()).getByText("1/10");
    const short = within(region()).getByText("Ends in 4:00");
    expect(count.parentElement).toBe(title.parentElement);
    expect(short.parentElement).toBe(title.parentElement);
    const toggle = screen.getByRole("button", { name: "Hide script" }) as HTMLElement;
    expect(toggle.parentElement).toBe(title.parentElement!.parentElement);
    expect(Number.parseInt(toggle.style.minHeight, 10)).toBeGreaterThanOrEqual(48);
    expect(Number.parseInt(toggle.style.minWidth, 10)).toBeGreaterThanOrEqual(48);
  });

  it("Back and Next sit in a footer outside the scrolling card area, so they never scroll out of reach", () => {
    render(<ScriptDrawer {...props()} />);
    const scroll = screen.getByTestId("script-scroll");
    expect(scroll.style.overflowY).toBe("auto");
    expect(scroll.contains(next())).toBe(false);
    expect(scroll.contains(screen.getByRole("button", { name: "Back" }))).toBe(false);
    expect(scroll.textContent).toContain("first tray of croissants");
  });

  it("the page-reload line is in the rules, in both languages", () => {
    const { rerender } = render(<ScriptDrawer {...props({ state: "before", startedAtMs: null, nowMs: null })} />);
    expect(within(region()).getByText("If this page reloads, tap Start again.")).toBeTruthy();
    rerender(<ScriptDrawer {...props({ lang: "id" })} />);
    expect(within(screen.getByRole("region", { name: "Skrip demo" })).getByText("Jika halaman ini dimuat ulang, ketuk Mulai lagi.")).toBeTruthy();
  });

  it("item 2: the reload line is shown before and while running, and hidden once the day has ended", () => {
    const { rerender } = render(<ScriptDrawer {...props({ state: "before", startedAtMs: null, nowMs: null })} />);
    expect(screen.queryByText("If this page reloads, tap Start again.")).toBeTruthy();
    rerender(<ScriptDrawer {...props()} />);
    expect(screen.queryByText("If this page reloads, tap Start again.")).toBeTruthy();
    rerender(<ScriptDrawer {...props({ state: "ended" })} />);
    expect(screen.queryByText("If this page reloads, tap Start again.")).toBeNull();
    rerender(<ScriptDrawer {...props({ state: "ended", lang: "id" })} />);
    expect(screen.queryByText("Jika halaman ini dimuat ulang, ketuk Mulai lagi.")).toBeNull();
  });

  it("an unknown script id renders nothing (no empty drawer)", () => {
    const { container } = render(<ScriptDrawer {...props({ scriptId: "nope" })} />);
    expect(container.textContent).toBe("");
  });

  it("prefers-reduced-motion turns the slide off", () => {
    render(<ScriptDrawer {...props({ reducedMotion: true })} />);
    expect(region().style.transition).toBe("none");
  });

  it("every action is a native button of at least 48 px", () => {
    render(<ScriptDrawer {...props()} />);
    for (const b of within(region()).getAllByRole("button")) {
      expect(Number.parseInt((b as HTMLElement).style.minHeight, 10)).toBeGreaterThanOrEqual(48);
    }
  });
});
