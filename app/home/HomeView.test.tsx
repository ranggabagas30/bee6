// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { LangProvider, useLang } from "@/lib/i18n/context";
import type { HomeResponse } from "@/lib/home/contract";
import { greetingKey, HomeView } from "@/app/home/HomeView";

afterEach(() => {
  cleanup();
});

const zero = { approved: 0, rejected: 0 };
const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

function baseData(overrides: Partial<HomeResponse> = {}): HomeResponse {
  return {
    today: "2026-10-09",
    day_status: "on",
    fact_count: 2,
    lines: [
      { start_hm: "09:00", category: "ROUTINE_OPS", summary: "FACT-1" },
      { start_hm: "11:00", category: "COMPLAINT", summary: "FACT-2" },
    ],
    more: 0,
    progress: { week: zero, month: zero, since_start: zero },
    waiting_approval: { count: 0, items: [] },
    next_review: { date: null, change_title: null },
    ...overrides,
  };
}

function renderView(data: HomeResponse, initial: "en" | "id" = "en", hour = 10) {
  return render(
    <LangProvider initial={initial}>
      <HomeView data={data} hour={hour} />
    </LangProvider>,
  );
}

describe("HomeView: today in five lines (R-06, kept)", () => {
  it("renders the lines as a plain ordered list in order (summaries only, no time or category), no blockquote/q; the only buttons are the window switch", () => {
    const { container } = renderView(baseData());
    const list = screen.getByRole("list");
    expect(list.tagName).toBe("OL");
    const items = within(list).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["FACT-1", "FACT-2"]);
    const text = container.textContent ?? "";
    expect(text).not.toContain("09:00");
    expect(text).not.toContain("Routine work");
    expect(text).not.toContain("Facts:");
    expect(container.querySelector("blockquote")).toBeNull();
    expect(container.querySelector("q")).toBeNull();
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons.length).toBe(3);
    expect(buttons.every((b) => b.hasAttribute("aria-pressed"))).toBe(true);
  });

  it("has the 'Today in five lines' heading", () => {
    renderView(baseData());
    expect(screen.getByRole("heading", { name: "Today in five lines" })).not.toBeNull();
  });

  it("more > 0 shows '+N more in the day record' linking to /day/<today>", () => {
    renderView(baseData({ more: 4 }));
    const link = screen.getByRole("link", { name: "+4 more in the day record" });
    expect(link.getAttribute("href")).toBe("/day/2026-10-09");
  });

  it("more === 0 shows no '+N more' link", () => {
    renderView(baseData({ more: 0 }));
    expect(screen.queryByText(/more in the day record/)).toBeNull();
  });

  it("always shows a link to the day record", () => {
    renderView(baseData());
    const link = screen.getByRole("link", { name: "See the full day (supervisor view)" });
    expect(link.getAttribute("href")).toBe("/day/2026-10-09");
  });

  it("no lines shows the owner empty line", () => {
    renderView(baseData({ lines: [], fact_count: 0 }));
    expect(screen.getByText("No confirmed facts for this date yet.")).not.toBeNull();
  });

  it("a blank summary shows the untranslated C-day-no-summary text", () => {
    renderView(baseData({ lines: [{ start_hm: "09:00", category: "ROUTINE_OPS", summary: "" }] }));
    expect(screen.getByText("No summary.")).not.toBeNull();
  });

  it("closed day shows 'Off / closed'", () => {
    renderView(baseData({ day_status: "closed" }));
    expect(screen.getByText("Off / closed")).not.toBeNull();
  });

  it("pending day shows 'Not started yet'", () => {
    renderView(baseData({ day_status: "pending" }));
    expect(screen.getByText("Not started yet")).not.toBeNull();
  });

  it("ID toggle switches chrome only, not the stored summary text", () => {
    function LangToggle() {
      const { setLang } = useLang();
      return (
        <button type="button" onClick={() => setLang("id")}>
          toggle-lang
        </button>
      );
    }
    render(
      <LangProvider initial="en">
        <LangToggle />
        <HomeView data={baseData()} hour={10} />
      </LangProvider>,
    );
    expect(screen.getByText("Today in five lines")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "toggle-lang" }));
    expect(screen.getByText("Hari ini dalam lima baris")).not.toBeNull();
    expect(screen.getByText("FACT-1")).not.toBeNull();
  });
});

describe("HomeView: greeting (W4)", () => {
  it.each([
    [0, "C-home-greeting-morning"],
    [11, "C-home-greeting-morning"],
    [12, "C-home-greeting-afternoon"],
    [17, "C-home-greeting-afternoon"],
    [18, "C-home-greeting-evening"],
    [23, "C-home-greeting-evening"],
  ])("hour %i -> %s", (hour, key) => {
    expect(greetingKey(hour)).toBe(key);
  });

  it("the h1 is the greeting with a full stop, and the hello line under it carries the business date", () => {
    renderView(baseData(), "en", 9);
    expect(screen.getByRole("heading", { level: 1, name: "Good morning." })).not.toBeNull();
    expect(screen.getByText("Fri 9 Oct · here is where things stand.")).not.toBeNull();
  });

  it.each([
    [9, "Good morning."],
    [14, "Good afternoon."],
    [20, "Good evening."],
  ])("hour %i reads %s", (hour, text) => {
    renderView(baseData(), "en", hour);
    expect(screen.getByRole("heading", { level: 1, name: text })).not.toBeNull();
  });

  it("reads in Bahasa", () => {
    renderView(baseData(), "id", 20);
    expect(screen.getByRole("heading", { level: 1, name: "Selamat malam." })).not.toBeNull();
    expect(screen.getByText(/Jum 9 Okt · begini keadaannya sekarang\./)).not.toBeNull();
  });
});

describe("HomeView: waiting for your approval (W4, R-25 T13)", () => {
  const two = {
    count: 2,
    items: [
      { proposal_id: UUID_A, change_title: "Read the order back" },
      { proposal_id: UUID_B, change_title: "Offer the fresh batch" },
    ],
  };

  it("nothing waiting and nothing decided yet -> heading with · 0 and today's empty copy", () => {
    renderView(baseData());
    expect(screen.getByRole("heading", { name: "Waiting for your approval · 0" })).not.toBeNull();
    expect(screen.getByText("Nothing waiting for you.")).not.toBeNull();
    expect(screen.getByText("Proposals appear here after the supervisor marks them feasible.")).not.toBeNull();
    expect(screen.queryByRole("link", { name: "See the new SOP version" })).toBeNull();
  });

  it("nothing waiting after decisions (UI-082) -> 'Nothing is waiting...' and a link to the SOP when a change shipped", () => {
    renderView(baseData({ progress: { week: { approved: 1, rejected: 1 }, month: zero, since_start: { approved: 1, rejected: 1 } } }));
    expect(screen.getByText("Nothing is waiting. You have decided every proposal sent to you.")).not.toBeNull();
    expect(screen.queryByText("Nothing waiting for you.")).toBeNull();
    expect(screen.getByRole("link", { name: "See the new SOP version" }).getAttribute("href")).toBe("/sop");
  });

  it("only rejections so far -> the after-decisions line but no SOP link (no version shipped)", () => {
    renderView(baseData({ progress: { week: zero, month: zero, since_start: { approved: 0, rejected: 2 } } }));
    expect(screen.getByText("Nothing is waiting. You have decided every proposal sent to you.")).not.toBeNull();
    expect(screen.queryByRole("link", { name: "See the new SOP version" })).toBeNull();
  });

  it("two waiting: the kicker heading, the 'Both marked feasible' sub, 'Review in order' to /proposals, numbered rows and the one-at-a-time box", () => {
    renderView(baseData({ waiting_approval: two }));
    expect(screen.getByRole("heading", { name: "Waiting for your approval · 2" })).not.toBeNull();
    expect(screen.getByText("Both marked feasible by the supervisor. In Bee6's recommended order.")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Review in order" }).getAttribute("href")).toBe("/proposals");
    const list = screen.getByRole("list", { name: "Waiting for your approval · 2" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toBe("#1Read the order back›");
    expect(rows[1]!.textContent).toBe("#2Offer the fresh batch›");
    const first = within(rows[0]!).getByRole("link", { name: "Review: Read the order back" });
    expect(first.getAttribute("href")).toBe(`/proposals?id=${UUID_A}`);
    expect(screen.getByText("One change at a time.")).not.toBeNull();
    expect(screen.getByText(/Once you approve one, the SOP changes, so the other can only be rejected with a reason\./)).not.toBeNull();
    expect(screen.queryByText(/more in Approvals/)).toBeNull();
  });

  it("one waiting: the single-proposal sub, no 'One change at a time' box", () => {
    renderView(baseData({ waiting_approval: { count: 1, items: [two.items[0]!] } }));
    expect(screen.getByText("Marked feasible by the supervisor.")).not.toBeNull();
    expect(screen.queryByText("One change at a time.")).toBeNull();
    expect(screen.getByRole("link", { name: "Review in order" })).not.toBeNull();
  });

  it("the rows carry no category chip, no start date and no per-row pill (the home route has only id + title)", () => {
    const { container } = renderView(baseData({ waiting_approval: two }));
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/Starts |Needs a decision|feasible Wed|STOCK|CUSTOMER|Supervisor marked it feasible/);
  });

  // The row is the target (board: the whole row links): at least 56 px tall by CSS (home-css.test.ts), in both languages.
  it("each row is one link with the .row tap-target class in English and Bahasa", () => {
    const data = baseData({ waiting_approval: { count: 1, items: [{ proposal_id: UUID_A, change_title: "Read the order back" }] } });
    const { unmount } = renderView(data, "en");
    expect(screen.getByRole("link", { name: "Review: Read the order back" }).className).toContain("row");
    unmount();
    renderView(data, "id");
    expect(screen.getByRole("link", { name: "Tinjau: Read the order back" }).className).toContain("row");
  });

  it("count beyond the five items shows '+N more in Approvals' linking to /proposals", () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ proposal_id: `${i}1111111-1111-4111-8111-111111111111`, change_title: `T${i}` }));
    renderView(baseData({ waiting_approval: { count: 8, items } }));
    const more = screen.getByRole("link", { name: "+3 more in Approvals" });
    expect(more.getAttribute("href")).toBe("/proposals");
    expect(screen.getByText("8 marked feasible by the supervisor. In Bee6's recommended order.")).not.toBeNull();
  });

  it("rows never show a device id, a role of the answerer or a proposal id as text (rule 7)", () => {
    const { container } = renderView(baseData({ waiting_approval: { count: 1, items: [{ proposal_id: UUID_A, change_title: "T" }] } }));
    expect(container.textContent).not.toContain(UUID_A);
  });

  it("has no Reset control (the judge guide hosts reset_demo)", () => {
    renderView(baseData({ waiting_approval: two }));
    expect(screen.queryByRole("button", { name: /reset/i })).toBeNull();
  });
});

describe("HomeView: progress as one sentence (W4, W6, R15)", () => {
  const progress = {
    week: { approved: 1, rejected: 0 },
    month: { approved: 3, rejected: 2 },
    since_start: { approved: 7, rejected: 4 },
  };

  it("defaults to Week: the kicker heading, the sentence with this week's tally and the sub; no number tiles", () => {
    renderView(baseData({ progress }));
    expect(screen.getByRole("heading", { name: "PROGRESS · THIS WEEK" })).not.toBeNull();
    const group = screen.getByRole("group", { name: "Progress window" });
    expect(within(group).getByRole("button", { name: "Week" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(group).getByRole("button", { name: "Month" }).getAttribute("aria-pressed")).toBe("false");
    expect(within(group).getByRole("button", { name: "Since start" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText("1 approved and 0 rejected this week.")).not.toBeNull();
    expect(screen.getByText("Approved changes are reviewed on a set date. A rejected change becomes a rule Bee6 respects.")).not.toBeNull();
    expect(screen.queryByTestId("tile-approved")).toBeNull();
    expect(screen.queryByTestId("tile-rejected")).toBeNull();
  });

  it("switching to Month and Since start changes the sentence and the kicker", () => {
    renderView(baseData({ progress }));
    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    expect(screen.getByText("3 approved and 2 rejected this month.")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "PROGRESS · THIS MONTH" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Since start" }));
    expect(screen.getByText("7 approved and 4 rejected since the start.")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "PROGRESS · SINCE START" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Since start" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("the tick shows only once something was decided in the window", () => {
    const { container, unmount } = renderView(baseData({ progress }));
    expect(container.querySelector("svg path[d^='M5 12.5']")).not.toBeNull();
    unmount();
    const empty = renderView(baseData());
    expect(empty.container.querySelector("svg path[d^='M5 12.5']")).toBeNull();
    expect(screen.getByText("0 approved and 0 rejected this week.")).not.toBeNull();
  });

  it("the sentence announces its change to assistive tech (live region)", () => {
    renderView(baseData({ progress }));
    expect(screen.getByTestId("progress-line").getAttribute("aria-live")).toBe("polite");
  });

  it("reads in Bahasa", () => {
    renderView(baseData({ progress }), "id");
    expect(screen.getByRole("heading", { name: "KEMAJUAN · MINGGU INI" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Sejak awal" })).not.toBeNull();
    expect(screen.getByText("1 disetujui dan 0 ditolak minggu ini.")).not.toBeNull();
  });
});

describe("HomeView: next review and cost (W4)", () => {
  it("no review scheduled -> 'No review scheduled yet' and when it appears", () => {
    renderView(baseData());
    const tile = screen.getByTestId("tile-review");
    expect(within(tile).getByRole("heading", { name: "Next review" })).not.toBeNull();
    expect(tile.textContent).toContain("No review scheduled yet");
    expect(tile.textContent).toContain("Appears after you approve a change");
  });

  it("a scheduled review shows the change title and its date", () => {
    renderView(baseData({ next_review: { date: "2026-10-24", change_title: "Read the order back" } }));
    const tile = screen.getByTestId("tile-review");
    expect(tile.textContent).toContain("Sat 24 Oct");
    expect(tile.textContent).toContain("Read the order back");
    expect(tile.textContent).not.toContain("No review scheduled yet");
  });

  it("cost per outlet-day is always 'coming soon' with no number", () => {
    renderView(baseData());
    const tile = screen.getByTestId("tile-cost");
    expect(tile.textContent).toContain("COST PER OUTLET-DAY");
    expect(tile.textContent).toContain("Coming soon");
    expect(tile.textContent).not.toMatch(/\d/);
  });

  it("no Team link or menu anywhere (D-9)", () => {
    const { container } = renderView(baseData());
    expect(container.textContent).not.toMatch(/\bTeam\b/);
    expect(screen.queryByRole("link", { name: /team/i })).toBeNull();
  });
});
