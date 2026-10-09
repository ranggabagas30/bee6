// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LangProvider, useLang } from "@/lib/i18n/context";
import { dayLabel } from "@/lib/i18n/format";
import type { Auth } from "@/lib/auth/client/firebase-client";
import type { DayRecordResponse, OwnerThread, SupervisorThread } from "@/lib/day/contract";
import { DayRecordView } from "@/app/day/DayRecordView";

afterEach(() => {
  cleanup();
});

const OWNER_HEADER_BASE = {
  date: "2026-10-08",
  today: "2026-10-09",
  day_status: "on" as const,
  sessions_cancelled: 0,
  capture_mode: "room" as const,
  fact_count: 4,
  truncated: false,
};

function ownerThread(overrides: Partial<OwnerThread> = {}): OwnerThread {
  return {
    row: 0,
    category: "ROUTINE_OPS",
    start_hm: "10:00",
    end_hm: "10:05",
    summary: "QSUM-SENTINEL should never appear here",
    confidence_pct: 90,
    display_status: "fact",
    ...overrides,
  };
}

function supervisorThread(overrides: Partial<SupervisorThread> = {}): SupervisorThread {
  return {
    row: 0,
    category: "COMPLAINT",
    start_hm: "10:00",
    end_hm: "10:05",
    summary: "A complaint.",
    confidence_pct: 70,
    display_status: "question_open",
    evidence: [],
    evidence_more: 0,
    staff_answer: null,
    runner_up: null,
    handle: null,
    can_review: false,
    ...overrides,
  };
}

const AUTH = {} as Auth;

function renderView(
  data: DayRecordResponse,
  overrides: { onPrev?: () => void; onNext?: () => void; onReload?: () => void } = {},
  initial: "en" | "id" = "en",
) {
  const onPrev = overrides.onPrev ?? (() => {});
  const onNext = overrides.onNext ?? (() => {});
  const onReload = overrides.onReload ?? (() => {});
  return render(
    <LangProvider initial={initial}>
      <DayRecordView data={data} auth={AUTH} onPrev={onPrev} onNext={onNext} onReload={onReload} />
    </LangProvider>,
  );
}

describe("DayRecordView — owner shape", () => {
  it("renders no blockquote/q/button and no sentinel text; counts line has no Questions", () => {
    const data: DayRecordResponse = {
      view: "owner",
      day: OWNER_HEADER_BASE,
      threads: [
        ownerThread({ row: 0, summary: "FACT-1" }),
        ownerThread({ row: 1, summary: "FACT-2" }),
        ownerThread({ row: 2, summary: "FACT-3" }),
        ownerThread({ row: 3, summary: "FACT-4" }),
      ],
    };
    const { container } = renderView(data);
    expect(container.querySelectorAll("article")).toHaveLength(4);
    for (const article of container.querySelectorAll("article")) {
      expect(article.querySelector("blockquote")).toBeNull();
      expect(article.querySelector("q")).toBeNull();
      expect(article.querySelector("button")).toBeNull();
    }
    expect(container.innerHTML).not.toContain("QSUM-SENTINEL");
    expect(container.innerHTML).not.toContain("EVID-SENTINEL");
    expect(container.innerHTML).not.toContain("REASON-SENTINEL");

    const text = container.textContent ?? "";
    expect(text).toContain("Facts: 4");
    expect(text).not.toContain("Questions");
  });

  it("zero threads on an 'on' day shows only C-day-empty-owner (no C-day-empty-2)", () => {
    const data: DayRecordResponse = {
      view: "owner",
      day: { ...OWNER_HEADER_BASE, fact_count: 0 },
      threads: [],
    };
    const { container } = renderView(data);
    expect(container.textContent).toContain("No confirmed facts for this date yet.");
    expect(container.textContent).not.toContain("Notes appear a few minutes after people speak.");
  });

  it("shows a Home link to /home (R-06 Task 14a)", () => {
    const data: DayRecordResponse = { view: "owner", day: OWNER_HEADER_BASE, threads: [] };
    renderView(data);
    const link = screen.getByRole("link", { name: "Home" });
    expect(link.getAttribute("href")).toBe("/home");
  });

  it("the Home link meets the 48px touch-target minimum (CLAUDE.md §2 global constraint)", () => {
    const data: DayRecordResponse = { view: "owner", day: OWNER_HEADER_BASE, threads: [] };
    renderView(data);
    const link = screen.getByRole("link", { name: "Home" }) as HTMLAnchorElement;
    expect(link.style.minHeight).toBe("48px");
    // jsdom has no layout engine, so getBoundingClientRect() cannot confirm
    // the real rendered height; the inline style is the load-bearing check
    // here (real-browser measurement should be re-confirmed by QA).
  });
});

describe("DayRecordView — supervisor shape", () => {
  const SUPERVISOR_HEADER = { ...OWNER_HEADER_BASE, question_count: 3 };

  it("shows no Home link (owner view only)", () => {
    const data: DayRecordResponse = { view: "supervisor", day: SUPERVISOR_HEADER, threads: [] };
    renderView(data);
    expect(screen.queryByRole("link", { name: "Home" })).toBeNull();
  });

  it("shows evidence in order and the +N more line", () => {
    const data: DayRecordResponse = {
      view: "supervisor",
      day: SUPERVISOR_HEADER,
      threads: [
        supervisorThread({
          row: 0,
          evidence: [
            { hm: "10:01", text: "EVID-1" },
            { hm: "10:02", text: "EVID-2" },
          ],
          evidence_more: 5,
        }),
      ],
    };
    const { container } = renderView(data);
    expect(container.textContent).toContain("+5 more lines");
    const blockquotes = Array.from(container.querySelectorAll("blockquote")).map((b) => b.textContent);
    expect(blockquotes).toEqual(["10:01 «EVID-1»", "10:02 «EVID-2»"]);
  });

  it("shows 'A staff member answered No:' with the reason for a rejected row", () => {
    const data: DayRecordResponse = {
      view: "supervisor",
      day: SUPERVISOR_HEADER,
      threads: [
        supervisorThread({
          row: 0,
          display_status: "rejected_by_staff",
          staff_answer: { answer: "no", reason: "REASON-SENTINEL-1" },
        }),
      ],
    };
    const { container } = renderView(data);
    expect(container.textContent).toContain("A staff member answered No:");
    expect(container.querySelector("q")?.textContent).toBe("REASON-SENTINEL-1");
  });

  it("shows the Yes line without a <q> when reason is null", () => {
    const data: DayRecordResponse = {
      view: "supervisor",
      day: SUPERVISOR_HEADER,
      threads: [
        supervisorThread({
          row: 0,
          display_status: "awaiting_supervisor",
          staff_answer: { answer: "yes", reason: null },
        }),
      ],
    };
    const { container } = renderView(data);
    expect(container.textContent).toContain("A staff member answered Yes:");
    expect(container.querySelector("q")).toBeNull();
  });

  it("supervisor empty 'on' day shows both empty lines", () => {
    const data: DayRecordResponse = {
      view: "supervisor",
      day: { ...SUPERVISOR_HEADER, fact_count: 0, question_count: 0 },
      threads: [],
    };
    const { container } = renderView(data);
    expect(container.textContent).toContain("No work notes for this date.");
    expect(container.textContent).toContain("Notes appear a few minutes after people speak.");
  });

  it("supervisor empty 'off' day shows only the off/closed + empty line (no empty-2)", () => {
    const data: DayRecordResponse = {
      view: "supervisor",
      day: { ...SUPERVISOR_HEADER, day_status: "off", fact_count: 0, question_count: 0 },
      threads: [],
    };
    const { container } = renderView(data);
    expect(container.textContent).toContain("Off / closed");
    expect(container.textContent).toContain("No work notes for this date.");
    expect(container.textContent).not.toContain("Notes appear a few minutes after people speak.");
  });

  it("supervisor, only questions (no facts) -> 'Facts: 0 · Questions: 3' and three cards", () => {
    const data: DayRecordResponse = {
      view: "supervisor",
      day: { ...SUPERVISOR_HEADER, fact_count: 0, question_count: 3 },
      threads: [
        supervisorThread({ row: 0 }),
        supervisorThread({ row: 1 }),
        supervisorThread({ row: 2 }),
      ],
    };
    const { container } = renderView(data);
    expect(container.textContent).toContain("Facts: 0");
    expect(container.textContent).toContain("Questions: 3");
    expect(container.querySelectorAll("article")).toHaveLength(3);
  });
});

describe("DayRecordView — category filter", () => {
  const data: DayRecordResponse = {
    view: "owner",
    day: { ...OWNER_HEADER_BASE, fact_count: 4 },
    threads: [
      ownerThread({ row: 0, category: "COMPLAINT", summary: "C1" }),
      ownerThread({ row: 1, category: "COMPLAINT", summary: "C2" }),
      ownerThread({ row: 2, category: "ROUTINE_OPS", summary: "R1" }),
      ownerThread({ row: 3, category: "ROUTINE_OPS", summary: "R2" }),
    ],
  };

  it("tapping a category chip narrows the list; All restores it", () => {
    renderView(data);
    fireEvent.click(screen.getByRole("button", { name: "Customer complaint (2)" }));
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Customer complaint (2)" }).getAttribute("aria-pressed"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "All (4)" }));
    expect(screen.getAllByRole("article")).toHaveLength(4);
  });

  it("switching language mid-filter keeps the filter applied and re-labels the chip", () => {
    function LangToggle() {
      const { setLang } = useLang();
      return (
        <button type="button" onClick={() => setLang("id")}>
          toggle-lang
        </button>
      );
    }
    const { container } = render(
      <LangProvider initial="en">
        <LangToggle />
        <DayRecordView data={data} auth={AUTH} onPrev={() => {}} onNext={() => {}} onReload={() => {}} />
      </LangProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Customer complaint (2)" }));
    expect(screen.getAllByRole("article")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "toggle-lang" }));
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(screen.getByText("Keluhan pelanggan (2)")).not.toBeNull();

    // Chrome (status/date labels) switches language, but the content text
    // the two remaining cards carry (their summaries — here standing in for
    // the thread's identity, "C1"/"C2") is untouched, and the old-language
    // chrome text is gone, not merely duplicated alongside the new one.
    expect(screen.getByText("C1")).not.toBeNull();
    expect(screen.getByText("C2")).not.toBeNull();
    expect(screen.getAllByText("Fakta").length).toBeGreaterThan(0);
    expect(container.querySelector("h1")?.textContent).toBe(dayLabel("2026-10-08", "id"));
    expect(container.textContent).not.toContain("Customer complaint");
  });
});

describe("DayRecordView — language toggle preserves stored content", () => {
  it("evidence lines, staff-answer reason, and runner-up why_not stay byte-identical across an EN -> ID toggle", () => {
    function LangToggle() {
      const { setLang } = useLang();
      return (
        <button type="button" onClick={() => setLang("id")}>
          toggle-lang
        </button>
      );
    }
    const data: DayRecordResponse = {
      view: "supervisor",
      day: { ...OWNER_HEADER_BASE, question_count: 1 },
      threads: [
        supervisorThread({
          row: 0,
          display_status: "rejected_by_staff",
          evidence: [{ hm: "10:01", text: "EVID-CONTENT-STRING" }],
          evidence_more: 0,
          staff_answer: { answer: "no", reason: "REASON-CONTENT-STRING" },
          runner_up: { category: "ROUTINE_OPS", why_not: "WHY-NOT-CONTENT-STRING" },
        }),
      ],
    };
    const { container } = render(
      <LangProvider initial="en">
        <LangToggle />
        <DayRecordView data={data} auth={AUTH} onPrev={() => {}} onNext={() => {}} onReload={() => {}} />
      </LangProvider>,
    );

    const evidenceBefore = container.querySelector("blockquote")?.textContent;
    const reasonBefore = container.querySelector("q")?.textContent;
    const whyNotBefore = container.querySelector("details p")?.textContent;
    // Sanity: the fixture content is actually present before toggling, not
    // an accidental pass from two `undefined`s.
    expect(evidenceBefore).toBe("10:01 «EVID-CONTENT-STRING»");
    expect(reasonBefore).toBe("REASON-CONTENT-STRING");
    expect(whyNotBefore).toBe("WHY-NOT-CONTENT-STRING");

    fireEvent.click(screen.getByRole("button", { name: "toggle-lang" }));

    const evidenceAfter = container.querySelector("blockquote")?.textContent;
    const reasonAfter = container.querySelector("q")?.textContent;
    const whyNotAfter = container.querySelector("details p")?.textContent;
    expect(evidenceAfter).toBe(evidenceBefore);
    expect(reasonAfter).toBe(reasonBefore);
    expect(whyNotAfter).toBe(whyNotBefore);
  });
});

describe("DayRecordView — header", () => {
  it("closed status shows 'Off / closed'", () => {
    const data: DayRecordResponse = {
      view: "owner",
      day: { ...OWNER_HEADER_BASE, day_status: "closed" },
      threads: [],
    };
    const { container } = renderView(data);
    expect(container.textContent).toContain("Off / closed");
  });

  it("pending status shows 'Not started yet'", () => {
    const data: DayRecordResponse = {
      view: "owner",
      day: { ...OWNER_HEADER_BASE, day_status: "pending" },
      threads: [],
    };
    const { container } = renderView(data);
    expect(container.textContent).toContain("Not started yet");
  });

  it("sessions_cancelled 0 shows no cancelled line; 2 shows it", () => {
    const zero: DayRecordResponse = {
      view: "owner",
      day: { ...OWNER_HEADER_BASE, sessions_cancelled: 0 },
      threads: [],
    };
    const { container: zeroContainer } = renderView(zero);
    expect(zeroContainer.textContent).not.toContain("Sessions cancelled");

    const two: DayRecordResponse = {
      view: "owner",
      day: { ...OWNER_HEADER_BASE, sessions_cancelled: 2 },
      threads: [],
    };
    const { container: twoContainer } = renderView(two);
    expect(twoContainer.textContent).toContain("Sessions cancelled: 2");
  });

  it("capture_mode wearable shows 'Mode: wearable'", () => {
    const data: DayRecordResponse = {
      view: "owner",
      day: { ...OWNER_HEADER_BASE, capture_mode: "wearable" },
      threads: [],
    };
    const { container } = renderView(data);
    expect(container.textContent).toContain("Mode: wearable");
  });

  it("truncated shows the truncation notice with the thread count", () => {
    const data: DayRecordResponse = {
      view: "owner",
      day: { ...OWNER_HEADER_BASE, truncated: true, fact_count: 2 },
      threads: [ownerThread({ row: 0 }), ownerThread({ row: 1 })],
    };
    const { container } = renderView(data);
    expect(container.textContent).toContain("Showing the first 2 notes.");
  });
});

describe("DayRecordView — 360px safety", () => {
  it("DayRecordView's container and card styles use no fixed width over 360 and overflowWrap: anywhere", () => {
    const data: DayRecordResponse = {
      view: "owner",
      day: OWNER_HEADER_BASE,
      threads: [ownerThread({ row: 0 })],
    };
    const { container } = renderView(data);
    const article = container.querySelector("article") as HTMLElement;
    expect(article.style.overflowWrap).toBe("anywhere");
    // The outer container is width-constrained by max-width only (percentage-
    // based at narrow viewports), never a fixed width in px below 360.
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.width).toBe("");
  });
});
