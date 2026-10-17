// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { LangProvider } from "@/lib/i18n/context";
import type { SupervisorThread, SupervisorUnlabelled } from "@/lib/day/contract";
import { buildTimeline } from "@/lib/day/view-model";
import { StaffDebrief } from "@/app/day/StaffDebrief";

afterEach(() => {
  cleanup();
});

function thread(overrides: Partial<SupervisorThread> = {}): SupervisorThread {
  return {
    row: 0,
    category: "CUSTOMER_SERVICE",
    start_hm: "10:40",
    end_hm: "10:45",
    summary: "SUMMARY-SENTINEL",
    confidence_pct: 90,
    display_status: "question_answered",
    evidence: [{ hm: "10:41", text: "EVIDENCE-SENTINEL" }],
    evidence_more: 0,
    staff_answer: null,
    runner_up: null,
    handle: null,
    can_review: false,
    ...overrides,
  };
}

function unlabelled(overrides: Partial<SupervisorUnlabelled> = {}): SupervisorUnlabelled {
  return { key: 0, after_row: null, start_hm: "09:00", end_hm: "09:02", display_status: "question_open", staff_answer: null, ...overrides };
}

function renderSection(threads: SupervisorThread[], un: SupervisorUnlabelled[] = [], lang: "en" | "id" = "en") {
  return render(
    <LangProvider initial={lang}>
      <StaffDebrief timeline={buildTimeline(threads, un, "ALL")} />
    </LangProvider>,
  );
}

describe("StaffDebrief", () => {
  it("renders the heading and the no-names sub line from the board", () => {
    renderSection([thread({ staff_answer: { answer: "yes", reason: null } })]);
    expect(screen.getByRole("heading", { level: 2, name: "Staff debrief" })).not.toBeNull();
    expect(
      screen.getByText("Questions Bee6 asked after closing. A staff member answered; no names are kept."),
    ).not.toBeNull();
  });

  it("one row per asked question with a Yes / No / Unverified / Open pill, in timeline order", () => {
    renderSection([
      thread({ row: 0, start_hm: "10:40", staff_answer: { answer: "yes", reason: "a customer asked at the display" } }),
      thread({ row: 1, start_hm: "11:00", display_status: "rejected_by_staff", staff_answer: { answer: "no", reason: "no time was written" } }),
      thread({ row: 2, start_hm: "12:00", display_status: "unverified" }),
      thread({ row: 3, start_hm: "13:00", display_status: "question_open" }),
      thread({ row: 4, start_hm: "14:00", display_status: "fact" }),
    ]);
    const rows = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.querySelector(".b6-pill")?.textContent)).toEqual(["Yes", "No", "Unverified", "Open"]);
    expect(rows[0]!.querySelector(".b6-pill")?.className).toContain("b6-pill--green");
    expect(rows[1]!.querySelector(".b6-pill")?.className).toContain("b6-pill--red");
    expect(rows[2]!.querySelector(".b6-pill")?.className).toContain("b6-pill--amber");
    expect(rows[0]!.textContent).toContain("Around 10:40 there was customer service. Is that right?");
  });

  it("shows the redacted reason in a <q> only when there is one, and never thread summary or evidence text", () => {
    const { container } = renderSection([
      thread({ row: 0, staff_answer: { answer: "yes", reason: "REASON-SENTINEL" } }),
      thread({ row: 1, staff_answer: { answer: "yes", reason: null } }),
    ]);
    const quotes = container.querySelectorAll("q");
    expect(quotes).toHaveLength(1);
    expect(quotes[0]!.textContent).toBe("REASON-SENTINEL");
    expect(container.textContent).not.toContain("SUMMARY-SENTINEL");
    expect(container.textContent).not.toContain("EVIDENCE-SENTINEL");
  });

  it("an unlabelled moment asks the generic block question", () => {
    renderSection([], [unlabelled()]);
    expect(screen.getByRole("list").textContent).toContain("Between 09:00 and 09:02 there was work. Is that right?");
  });

  it("says so when no question was asked that day", () => {
    renderSection([thread({ display_status: "fact" })]);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByText("No debrief questions for this day.")).not.toBeNull();
  });

  it("names no person and no device: no 'answered by', no id-shaped attribute", () => {
    const { container } = renderSection([thread({ staff_answer: { answer: "yes", reason: null } })]);
    expect(container.textContent?.toLowerCase()).not.toMatch(/answered by|device/);
    expect(container.innerHTML).not.toMatch(/data-(device|question|thread)/);
  });

  it("re-labels in Bahasa and keeps the stored reason byte-identical", () => {
    const { container } = renderSection([thread({ staff_answer: { answer: "no", reason: "REASON-CONTENT" } })], [], "id");
    expect(screen.getByRole("heading", { level: 2, name: "Debrief staf" })).not.toBeNull();
    expect(container.querySelector(".b6-pill")?.textContent).toBe("Tidak");
    expect(container.querySelector("q")?.textContent).toBe("REASON-CONTENT");
  });
});
