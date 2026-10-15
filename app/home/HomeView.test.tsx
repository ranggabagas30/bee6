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
  it("renders lines in order, with the category label, no blockquote/q; the only buttons are the window switch", () => {
    const { container } = renderView(baseData());
    const text = container.textContent ?? "";
    expect(text.indexOf("FACT-1")).toBeLessThan(text.indexOf("FACT-2"));
    expect(text).toContain("09:00");
    expect(text).toContain("Routine work");
    expect(text).toContain("Customer complaint");
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
    const link = screen.getByRole("link", { name: "Open the day record" });
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

  it("the h1 is the greeting with the business date under it", () => {
    renderView(baseData(), "en", 9);
    expect(screen.getByRole("heading", { level: 1, name: "Good morning" })).not.toBeNull();
    expect(screen.getByText("Fri 9 Oct")).not.toBeNull();
  });

  it("reads in Bahasa", () => {
    renderView(baseData(), "id", 20);
    expect(screen.getByRole("heading", { level: 1, name: "Selamat malam" })).not.toBeNull();
  });
});

describe("HomeView: waiting for your approval (W4)", () => {
  it("empty -> heading with · 0 and the approvals empty state", () => {
    renderView(baseData());
    expect(screen.getByRole("heading", { name: "Waiting for your approval · 0" })).not.toBeNull();
    expect(screen.getByText("Nothing waiting for you.")).not.toBeNull();
    expect(screen.getByText("Proposals appear here after the supervisor marks them feasible.")).not.toBeNull();
  });

  it("each row: the change title, 'Supervisor marked it feasible', and a Review link to the approvals page by id", () => {
    renderView(
      baseData({
        waiting_approval: {
          count: 2,
          items: [
            { proposal_id: UUID_A, change_title: "Read the order back" },
            { proposal_id: UUID_B, change_title: "Offer the fresh batch" },
          ],
        },
      }),
    );
    expect(screen.getByRole("heading", { name: "Waiting for your approval · 2" })).not.toBeNull();
    const list = screen.getByRole("list", { name: "Waiting for your approval · 2" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("Read the order back");
    expect(rows[0]!.textContent).toContain("Supervisor marked it feasible");
    const review = within(rows[0]!).getByRole("link", { name: "Review: Read the order back" });
    expect(review.getAttribute("href")).toBe(`/proposals?id=${UUID_A}`);
    expect(review.textContent).toBe("Review");
    expect(screen.queryByText(/more in Approvals/)).toBeNull();
  });

  // Integration QA (R-19): "Tinjau" measured 38 x 48 px at 360 px. The width comes from the `.link` rule (44 px min,
  // home-css.test.ts), so both the EN and the ID label must carry that class, not a copy-dependent one.
  it("the per-row Review link carries the .link tap-target rule in English (Review) and Bahasa (Tinjau)", () => {
    const data = baseData({ waiting_approval: { count: 1, items: [{ proposal_id: UUID_A, change_title: "Read the order back" }] } });
    const { unmount } = renderView(data, "en");
    const en = screen.getByRole("link", { name: "Review: Read the order back" });
    expect(en.textContent).toBe("Review");
    expect(en.className).toContain("link");
    unmount();
    renderView(data, "id");
    const id = screen.getByRole("link", { name: "Tinjau: Read the order back" });
    expect(id.textContent).toBe("Tinjau");
    expect(id.className).toContain("link");
  });

  it("count beyond the five items shows '+N more in Approvals' linking to /proposals", () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ proposal_id: `${i}1111111-1111-4111-8111-111111111111`, change_title: `T${i}` }));
    renderView(baseData({ waiting_approval: { count: 8, items } }));
    const more = screen.getByRole("link", { name: "+3 more in Approvals" });
    expect(more.getAttribute("href")).toBe("/proposals");
  });

  it("rows never show a device id, a role of the answerer or a proposal id as text (rule 7)", () => {
    const { container } = renderView(baseData({ waiting_approval: { count: 1, items: [{ proposal_id: UUID_A, change_title: "T" }] } }));
    expect(container.textContent).not.toContain(UUID_A);
  });
});

describe("HomeView: progress (W4, W6)", () => {
  const progress = {
    week: { approved: 1, rejected: 0 },
    month: { approved: 3, rejected: 2 },
    since_start: { approved: 7, rejected: 4 },
  };

  it("defaults to Week and shows Approved (started, waiting for review) and Rejected counts", () => {
    renderView(baseData({ progress }));
    expect(screen.getByRole("heading", { name: "Progress" })).not.toBeNull();
    const group = screen.getByRole("group", { name: "Progress window" });
    const week = within(group).getByRole("button", { name: "Week" });
    expect(week.getAttribute("aria-pressed")).toBe("true");
    expect(within(group).getByRole("button", { name: "Month" }).getAttribute("aria-pressed")).toBe("false");
    expect(within(group).getByRole("button", { name: "Since start" }).getAttribute("aria-pressed")).toBe("false");
    const approved = screen.getByTestId("tile-approved");
    expect(approved.textContent).toContain("APPROVED");
    expect(approved.textContent).toContain("1");
    expect(approved.textContent).toContain("started, waiting for review");
    const rejected = screen.getByTestId("tile-rejected");
    expect(rejected.textContent).toContain("REJECTED");
    expect(rejected.textContent).toContain("0");
  });

  it("switching to Month and Since start changes both counts", () => {
    renderView(baseData({ progress }));
    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    expect(screen.getByTestId("tile-approved").textContent).toContain("3");
    expect(screen.getByTestId("tile-rejected").textContent).toContain("2");
    fireEvent.click(screen.getByRole("button", { name: "Since start" }));
    expect(screen.getByTestId("tile-approved").textContent).toContain("7");
    expect(screen.getByTestId("tile-rejected").textContent).toContain("4");
    expect(screen.getByRole("button", { name: "Since start" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("the counts announce their change to assistive tech (live region)", () => {
    renderView(baseData({ progress }));
    const live = screen.getByTestId("progress-tiles");
    expect(live.getAttribute("aria-live")).toBe("polite");
  });

  it("reads in Bahasa", () => {
    renderView(baseData({ progress }), "id");
    expect(screen.getByRole("heading", { name: "Kemajuan" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Sejak awal" })).not.toBeNull();
    expect(screen.getByTestId("tile-approved").textContent).toContain("DISETUJUI");
  });
});

describe("HomeView: next review and cost (W4)", () => {
  it("no review scheduled -> an em dash and 'No data yet'", () => {
    renderView(baseData());
    const tile = screen.getByTestId("tile-review");
    expect(tile.textContent).toContain("NEXT REVIEW");
    expect(tile.textContent).toContain("—");
    expect(tile.textContent).toContain("No data yet");
  });

  it("a scheduled review shows its date and the change title", () => {
    renderView(baseData({ next_review: { date: "2026-10-24", change_title: "Read the order back" } }));
    const tile = screen.getByTestId("tile-review");
    expect(tile.textContent).toContain("Sat 24 Oct");
    expect(tile.textContent).toContain("Read the order back");
    expect(tile.textContent).not.toContain("No data yet");
  });

  it("cost per outlet is always 'coming soon' with no number", () => {
    renderView(baseData());
    const tile = screen.getByTestId("tile-cost");
    expect(tile.textContent).toContain("COST PER OUTLET");
    expect(tile.textContent).toContain("Coming soon");
    expect(tile.textContent).toContain("—");
    expect(tile.textContent).not.toMatch(/\d/);
  });

  it("no Team link or menu anywhere (D-9)", () => {
    const { container } = renderView(baseData());
    expect(container.textContent).not.toMatch(/\bTeam\b/);
    expect(screen.queryByRole("link", { name: /team/i })).toBeNull();
  });
});
