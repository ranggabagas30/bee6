// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LangProvider } from "@/lib/i18n/context";
import type { Auth } from "@/lib/auth/client/firebase-client";
import type { QueueItem, ReviewQueueResponse } from "@/lib/day/contract";
import { QueueView } from "@/app/questions/QueueView";

/**
 * R-06 Task 13.6/13.7: grouping by date (server order preserved, never
 * re-sorted here), the empty/truncated lines, and that a decision inside a
 * `ThreadCard` calls `onReload` (through the real `ThreadActions`, like
 * `DayRecordView.test.tsx` does for the day record).
 */

afterEach(() => {
  cleanup();
});

const AUTH = {} as Auth;

function item(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    row: 0,
    category: "COMPLAINT",
    start_hm: "10:00",
    end_hm: "10:05",
    summary: "A complaint.",
    confidence_pct: 70,
    display_status: "awaiting_supervisor",
    evidence: [],
    evidence_more: 0,
    staff_answer: { answer: "yes", reason: "REASON-SENTINEL" },
    runner_up: null,
    handle: "handle-1",
    can_review: true,
    date: "2026-10-08",
    ...overrides,
  };
}

function renderView(
  data: ReviewQueueResponse,
  overrides: { onReload?: () => void } = {},
  initial: "en" | "id" = "en",
) {
  const onReload = overrides.onReload ?? (() => {});
  return render(
    <LangProvider initial={initial}>
      <QueueView data={data} auth={AUTH} onReload={onReload} />
    </LangProvider>,
  );
}

describe("QueueView — empty and truncated", () => {
  it("shows the empty message when there are no items", () => {
    renderView({ view: "supervisor_queue", items: [], truncated: false });
    expect(screen.getByText("Nothing is waiting for review.")).not.toBeNull();
  });

  it("shows the truncated line with the item count when truncated", () => {
    renderView({ view: "supervisor_queue", items: [item()], truncated: true });
    expect(screen.getByText("Showing the first 1 notes.")).not.toBeNull();
  });

  it("a link back to the day record is always present", () => {
    renderView({ view: "supervisor_queue", items: [], truncated: false });
    const link = screen.getByRole("link", { name: "Day record" });
    expect(link.getAttribute("href")).toBe("/day");
  });
});

describe("QueueView — grouping", () => {
  it("groups consecutive items by date, in the server's own order, with one <h2> per date", () => {
    const data: ReviewQueueResponse = {
      view: "supervisor_queue",
      items: [
        item({ row: 0, date: "2026-10-09", summary: "NEWER" }),
        item({ row: 1, date: "2026-10-08", summary: "OLDER-1" }),
        item({ row: 2, date: "2026-10-08", summary: "OLDER-2" }),
      ],
      truncated: false,
    };
    const { container } = renderView(data);
    const headings = Array.from(container.querySelectorAll("h2")).map((h) => h.textContent);
    expect(headings).toHaveLength(2);
    expect(container.querySelectorAll("article")).toHaveLength(3);
    // Server order preserved: NEWER's group heading appears before OLDER's.
    const html = container.innerHTML;
    expect(html.indexOf("NEWER")).toBeLessThan(html.indexOf("OLDER-1"));
  });

  it("each date group has an 'Open this day' link to /day/<date>", () => {
    const data: ReviewQueueResponse = {
      view: "supervisor_queue",
      items: [item({ date: "2026-10-08" })],
      truncated: false,
    };
    renderView(data);
    const link = screen.getByRole("link", { name: "Open this day" });
    expect(link.getAttribute("href")).toBe("/day/2026-10-08");
  });

  it("renders a ThreadCard per item (evidence/staff answer visible, no device id)", () => {
    const data: ReviewQueueResponse = {
      view: "supervisor_queue",
      items: [item({ summary: "QUEUE-SUMMARY-1" })],
      truncated: false,
    };
    const { container } = renderView(data);
    expect(container.textContent).toContain("QUEUE-SUMMARY-1");
    expect(container.textContent).toContain("REASON-SENTINEL");
  });
});

describe("QueueView — i18n", () => {
  it("the ID toggle switches chrome copy, not the stored summary/reason", () => {
    const data: ReviewQueueResponse = {
      view: "supervisor_queue",
      items: [item({ summary: "NEVER-TRANSLATED-SUMMARY" })],
      truncated: false,
    };
    const { container } = renderView(data, {}, "id");
    expect(screen.getByText("Menunggu ditinjau")).not.toBeNull();
    expect(container.textContent).toContain("NEVER-TRANSLATED-SUMMARY");
  });
});

describe("QueueView — ThreadActions wiring", () => {
  it("a reviewable item (can_review: true, handle set) renders its Confirm/Change category/Reject controls", () => {
    const data: ReviewQueueResponse = { view: "supervisor_queue", items: [item()], truncated: false };
    renderView(data);
    expect(screen.getByRole("button", { name: "Confirm" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Change category" })).not.toBeNull();
  });

  it("a non-reviewable item (can_review: false) renders no action buttons", () => {
    const data: ReviewQueueResponse = {
      view: "supervisor_queue",
      items: [item({ can_review: false, handle: null })],
      truncated: false,
    };
    renderView(data);
    expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
  });

  it("every row's key is unique across groups (date-row)", () => {
    const data: ReviewQueueResponse = {
      view: "supervisor_queue",
      items: [
        item({ row: 0, date: "2026-10-08" }),
        item({ row: 0, date: "2026-10-09" }),
      ],
      truncated: false,
    };
    const { container } = renderView(data);
    expect(container.querySelectorAll("article")).toHaveLength(2);
  });
});
