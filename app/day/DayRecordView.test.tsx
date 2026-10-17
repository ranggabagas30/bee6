// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { LangProvider, useLang } from "@/lib/i18n/context";
import { dayLabel } from "@/lib/i18n/format";
import type { Auth } from "@/lib/auth/client/firebase-client";
import type { DayRecordResponse, OwnerThread, SupervisorThread, SupervisorUnlabelled } from "@/lib/day/contract";
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

function unlabelledItem(overrides: Partial<SupervisorUnlabelled> = {}): SupervisorUnlabelled {
  return {
    key: 0,
    after_row: null,
    start_hm: "09:00",
    end_hm: "09:02",
    display_status: "question_open",
    staff_answer: null,
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
    expect(text).not.toContain("Facts:");
    expect(text).not.toContain("Questions");
    // The owner's one tile is the count of notes; no debrief answers, no check tile, no Staff debrief section.
    expect(text).toContain("WORK NOTES");
    expect(screen.queryByText("DEBRIEF ANSWERS")).toBeNull();
    expect(screen.queryByText("NEED YOUR CHECK")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Staff debrief" })).toBeNull();
  });

  it("zero threads on an 'on' day shows the empty state with both lines (R-19 PR-6 §8.3)", () => {
    const data: DayRecordResponse = {
      view: "owner",
      day: { ...OWNER_HEADER_BASE, fact_count: 0 },
      threads: [],
    };
    const { container } = renderView(data);
    expect(container.textContent).toContain("No notes for this day yet.");
    expect(container.textContent).toContain("Notes appear after the shop phone listens and Bee6 reads the day.");
    expect(container.textContent).not.toContain("No confirmed facts for this date yet.");
  });

  it("renders no in-page links: the nav row carries Home and the other routes (R-25 T9)", () => {
    const data: DayRecordResponse = { view: "owner", day: OWNER_HEADER_BASE, threads: [ownerThread()] };
    renderView(data);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("shows the owner's single tile with the note count", () => {
    const data: DayRecordResponse = {
      view: "owner",
      day: OWNER_HEADER_BASE,
      threads: [ownerThread({ row: 0 }), ownerThread({ row: 1 }), ownerThread({ row: 2 })],
    };
    renderView(data);
    const tile = screen.getByText("WORK NOTES").closest(".b6-tile") as HTMLElement;
    expect(tile.querySelector(".b6-tile__value")?.textContent).toBe("3");
  });
});

describe("DayRecordView — supervisor shape", () => {
  const SUPERVISOR_HEADER = { ...OWNER_HEADER_BASE, question_count: 3 };

  it("shows no Home link (owner view only)", () => {
    const data: DayRecordResponse = { view: "supervisor", day: SUPERVISOR_HEADER, threads: [], unlabelled: [] };
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
      unlabelled: [],
    };
    const { container } = renderView(data);
    expect(container.textContent).toContain("+5 more lines");
    const blockquotes = Array.from(container.querySelectorAll("blockquote")).map((b) => b.textContent);
    expect(blockquotes).toEqual(["10:01\u201CEVID-1\u201D", "10:02\u201CEVID-2\u201D"]);
  });

  it("supervisor empty 'on' day shows both empty lines", () => {
    const data: DayRecordResponse = {
      view: "supervisor",
      day: { ...SUPERVISOR_HEADER, fact_count: 0, question_count: 0 },
      threads: [],
      unlabelled: [],
    };
    const { container } = renderView(data);
    expect(container.textContent).toContain("No notes for this day yet.");
    expect(container.textContent).toContain("Notes appear after the shop phone listens and Bee6 reads the day.");
  });

  it("supervisor empty 'off' day shows only the off/closed + empty line (no empty-2)", () => {
    const data: DayRecordResponse = {
      view: "supervisor",
      day: { ...SUPERVISOR_HEADER, day_status: "off", fact_count: 0, question_count: 0 },
      threads: [],
      unlabelled: [],
    };
    const { container } = renderView(data);
    expect(container.textContent).toContain("Off / closed");
    expect(container.textContent).toContain("No notes for this day yet.");
    expect(container.textContent).not.toContain("Notes appear after the shop phone listens and Bee6 reads the day.");
  });

  it("supervisor, only questions (no facts) -> three rows and no 'Facts / Questions' line", () => {
    const data: DayRecordResponse = {
      view: "supervisor",
      day: { ...SUPERVISOR_HEADER, fact_count: 0, question_count: 3 },
      threads: [
        supervisorThread({ row: 0 }),
        supervisorThread({ row: 1 }),
        supervisorThread({ row: 2 }),
      ],
      unlabelled: [],
    };
    const { container } = renderView(data);
    expect(container.textContent).not.toContain("Facts:");
    expect(container.textContent).not.toContain("Questions: 3");
    expect(container.querySelectorAll("article")).toHaveLength(3);
  });
});

describe("DayRecordView — unlabelled moments (Task 12)", () => {
  const SUPERVISOR_HEADER = { ...OWNER_HEADER_BASE, question_count: 2 };

  it("renders an unlabelled card with no blockquote/button, the status badge, and the help text", () => {
    const data: DayRecordResponse = {
      view: "supervisor",
      day: SUPERVISOR_HEADER,
      threads: [],
      unlabelled: [unlabelledItem({ display_status: "unverified" })],
    };
    const { container } = renderView(data);
    const articles = container.querySelectorAll("article");
    expect(articles).toHaveLength(1);
    expect(articles[0]!.querySelector("blockquote")).toBeNull();
    expect(articles[0]!.querySelector("button")).toBeNull();
    expect(container.textContent).toContain("Not labelled");
    expect(container.textContent).toContain("Unverified");
    expect(container.textContent).toContain("Could not label this. Staff were asked about it.");
  });

  it("lists the staff answer to an unlabelled moment in the Staff debrief section, not on its card", () => {
    const data: DayRecordResponse = {
      view: "supervisor",
      day: SUPERVISOR_HEADER,
      threads: [],
      unlabelled: [
        unlabelledItem({
          key: 0,
          display_status: "question_answered",
          staff_answer: { answer: "yes", reason: "UNL-REASON-SENTINEL" },
        }),
      ],
    };
    const { container } = renderView(data);
    expect(container.querySelector("article")?.textContent).not.toContain("UNL-REASON-SENTINEL");
    const section = screen.getByRole("region", { name: "Staff debrief" });
    expect(section.querySelector("q")?.textContent).toBe("UNL-REASON-SENTINEL");
    expect(section.textContent).toContain("Between 09:00 and 09:02 there was work. Is that right?");
  });

  it("owner shape never renders an unlabelled card (the owner response has no unlabelled field)", () => {
    const data: DayRecordResponse = {
      view: "owner",
      day: OWNER_HEADER_BASE,
      threads: [ownerThread({ row: 0 })],
    };
    const { container } = renderView(data);
    expect(container.querySelectorAll("article")).toHaveLength(1);
    expect(container.textContent).not.toContain("Not labelled");
  });

  it("the 'Not labelled (N)' chip only appears when there is at least one unlabelled row", () => {
    const withUnlabelled: DayRecordResponse = {
      view: "supervisor",
      day: SUPERVISOR_HEADER,
      threads: [supervisorThread({ row: 0 })],
      unlabelled: [unlabelledItem(), unlabelledItem({ key: 1 })],
    };
    const { container: withContainer } = renderView(withUnlabelled);
    expect(screen.getByRole("button", { name: "Not labelled (2)" })).not.toBeNull();
    expect(withContainer.textContent).toContain("All (3)"); // 1 thread + 2 unlabelled

    cleanup();
    const withoutUnlabelled: DayRecordResponse = {
      view: "supervisor",
      day: { ...SUPERVISOR_HEADER, question_count: 0 },
      threads: [supervisorThread({ row: 0 })],
      unlabelled: [],
    };
    renderView(withoutUnlabelled);
    expect(screen.queryByRole("button", { name: /Not labelled/ })).toBeNull();
  });

  it("tapping the 'Not labelled' chip narrows to unlabelled cards only; All restores the full timeline", () => {
    const data: DayRecordResponse = {
      view: "supervisor",
      day: SUPERVISOR_HEADER,
      threads: [supervisorThread({ row: 0, category: "ROUTINE_OPS" })],
      unlabelled: [unlabelledItem({ after_row: 0 })],
    };
    renderView(data);
    expect(screen.getAllByRole("article")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: /Not labelled/ }));
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("article").textContent).toContain("Not labelled");

    fireEvent.click(screen.getByRole("button", { name: /^All/ }));
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });

  it("a category chip hides every unlabelled card (only threads of that category show)", () => {
    const data: DayRecordResponse = {
      view: "supervisor",
      day: SUPERVISOR_HEADER,
      threads: [supervisorThread({ row: 0, category: "ROUTINE_OPS" })],
      unlabelled: [unlabelledItem({ after_row: 0 })],
    };
    renderView(data);
    fireEvent.click(screen.getByRole("button", { name: /Routine/ }));
    const articles = screen.getAllByRole("article");
    expect(articles).toHaveLength(1);
    expect(articles[0]!.textContent).not.toContain("Not labelled");
  });

  it("interleaves an unlabelled row after its thread, and one before every thread comes first", () => {
    const data: DayRecordResponse = {
      view: "supervisor",
      day: { ...SUPERVISOR_HEADER, question_count: 2 },
      threads: [
        supervisorThread({ row: 0, summary: "THREAD-A" }),
        supervisorThread({ row: 1, summary: "THREAD-B" }),
      ],
      unlabelled: [
        unlabelledItem({ key: 0, after_row: null }),
        unlabelledItem({ key: 1, after_row: 0 }),
      ],
    };
    const { container } = renderView(data);
    const order = Array.from(container.querySelectorAll("article")).map((a) =>
      a.textContent?.includes("THREAD-A")
        ? "A"
        : a.textContent?.includes("THREAD-B")
          ? "B"
          : "U",
    );
    expect(order).toEqual(["U", "A", "U", "B"]);
  });

  it("supervisor empty state requires both threads and unlabelled to be empty", () => {
    const onlyUnlabelled: DayRecordResponse = {
      view: "supervisor",
      day: { ...SUPERVISOR_HEADER, fact_count: 0, question_count: 1 },
      threads: [],
      unlabelled: [unlabelledItem()],
    };
    const { container } = renderView(onlyUnlabelled);
    expect(container.textContent).not.toContain("No notes for this day yet.");
    expect(container.querySelectorAll("article")).toHaveLength(1);
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
    expect(screen.getAllByText("Dilabeli otomatis").length).toBeGreaterThan(0);
    expect(container.querySelector("h1")?.textContent).toBe("Catatan hari");
    expect(container.querySelector("time")?.textContent).toBe(dayLabel("2026-10-08", "id"));
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
      unlabelled: [],
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
    expect(evidenceBefore).toBe("10:01\u201CEVID-CONTENT-STRING\u201D");
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

  it("capture_mode no longer renders a 'Mode' line (R-25 T9)", () => {
    const data: DayRecordResponse = {
      view: "owner",
      day: { ...OWNER_HEADER_BASE, capture_mode: "wearable" },
      threads: [],
    };
    const { container } = renderView(data);
    expect(container.textContent).not.toContain("Mode:");
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

  it("truncated count includes unlabelled rows, not just threads (tech-lead PR-6 review, finding 3)", () => {
    const data: DayRecordResponse = {
      view: "supervisor",
      day: { ...OWNER_HEADER_BASE, truncated: true, question_count: 3 },
      threads: [supervisorThread({ row: 0 })],
      unlabelled: [unlabelledItem({ key: 0 }), unlabelledItem({ key: 1 })],
    };
    const { container } = renderView(data);
    // 1 thread + 2 unlabelled = 3, not 1.
    expect(container.textContent).toContain("Showing the first 3 notes.");
  });
});

describe("DayRecordView — 360px safety", () => {
  it("the notes list is a card whose rows wrap long words, with no fixed pixel width in inline styles", () => {
    const data: DayRecordResponse = {
      view: "owner",
      day: OWNER_HEADER_BASE,
      threads: [ownerThread({ row: 0 })],
    };
    const { container } = renderView(data);
    const list = screen.getByRole("list", { name: "Work notes" });
    expect(list.className).toContain("b6-card");
    // Layout lives in day.module.css (min-width: 0 grid, overflow-wrap: anywhere); nothing inline can pin a width.
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
  });
});

describe("DayRecordView — filled supervisor day (board D2-02)", () => {
  const SUPERVISOR_HEADER = { ...OWNER_HEADER_BASE, question_count: 5 };
  const FILLED: DayRecordResponse = {
    view: "supervisor",
    day: SUPERVISOR_HEADER,
    threads: [
      supervisorThread({ row: 0, category: "ROUTINE_OPS", start_hm: "07:30", summary: "Opening done", display_status: "fact", confidence_pct: 95 }),
      supervisorThread({
        row: 1,
        category: "CUSTOMER_SERVICE",
        start_hm: "10:40",
        summary: "A customer asked about the egg tarts",
        display_status: "awaiting_supervisor",
        staff_answer: { answer: "yes", reason: "a customer asked at the display" },
        evidence: [{ hm: "10:41", text: "Are these egg tarts fresh today?" }],
        can_review: true,
        handle: "H-1",
      }),
      supervisorThread({
        row: 2,
        category: "ROUTINE_OPS",
        start_hm: "13:05",
        summary: "Cinnamon rolls refilled",
        display_status: "rejected_by_staff",
        staff_answer: { answer: "no", reason: "no time was written on the tray" },
      }),
      supervisorThread({ row: 3, category: "ROUTINE_OPS", start_hm: "21:00", summary: "Closing done", display_status: "unverified" }),
    ],
    unlabelled: [unlabelledItem({ key: 0, after_row: 3, display_status: "question_open" })],
  };

  function tile(label: string): HTMLElement {
    return screen.getByText(label).closest(".b6-tile") as HTMLElement;
  }

  it("shows exactly three tiles (no listening-coverage tile): WORK NOTES, DEBRIEF ANSWERS, NEED YOUR CHECK", () => {
    renderView(FILLED);
    const tiles = within(screen.getByRole("list", { name: "Day summary" })).getAllByRole("listitem");
    expect(tiles).toHaveLength(3);
    expect(screen.queryByText(/LISTENING COVERAGE/)).toBeNull();
    expect(tiles.map((li) => li.querySelector(".b6-kicker")?.textContent)).toEqual(["WORK NOTES", "DEBRIEF ANSWERS", "NEED YOUR CHECK"]);
  });

  it("computes the tile values from the response: notes, 'answered of asked' + unverified, need-your-check + first item", () => {
    renderView(FILLED);
    expect(tile("WORK NOTES").querySelector(".b6-tile__value")?.textContent).toBe("4");
    expect(tile("WORK NOTES").textContent).toContain("1 not labelled");
    // asked: threads 1, 2, 3 + the unlabelled moment = 4; answered: yes + no = 2; unverified: 1.
    expect(tile("DEBRIEF ANSWERS").querySelector(".b6-tile__value")?.textContent).toBe("2 of 4");
    expect(tile("DEBRIEF ANSWERS").textContent).toContain("1 unverified");
    // need your check: 1 reviewable thread + 1 open unlabelled.
    const check = tile("NEED YOUR CHECK");
    expect(check.querySelector(".b6-tile__value")?.textContent).toBe("2");
    expect(check.className).toContain("b6-tile--amber");
    expect(check.textContent).toContain("10:40 \u00B7 Customer service +1 more");
  });

  it("the check tile is not amber and says so when nothing needs a decision", () => {
    renderView({ ...FILLED, threads: [supervisorThread({ row: 0, display_status: "fact" })], unlabelled: [] });
    const check = tile("NEED YOUR CHECK");
    expect(check.className).not.toContain("b6-tile--amber");
    expect(check.querySelector(".b6-tile__value")?.textContent).toBe("0");
    expect(check.textContent).toContain("Nothing to check");
    expect(tile("DEBRIEF ANSWERS").textContent).toContain("No questions asked");
  });

  it("renders the sections in board order: header, tiles, filter, notes card, Staff debrief", () => {
    renderView(FILLED);
    const h1 = screen.getByRole("heading", { level: 1 });
    const tiles = screen.getByRole("list", { name: "Day summary" });
    const filter = screen.getByRole("group", { name: "Filter by category" });
    const notes = screen.getByRole("list", { name: "Work notes" });
    const debrief = screen.getByRole("region", { name: "Staff debrief" });
    const follows = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(h1, tiles)).toBe(true);
    expect(follows(tiles, filter)).toBe(true);
    expect(follows(filter, notes)).toBe(true);
    expect(follows(notes, debrief)).toBe(true);
  });

  it("the Staff debrief section lists the answers and reasons that no longer sit on the cards", () => {
    renderView(FILLED);
    const debrief = screen.getByRole("region", { name: "Staff debrief" });
    const pills = Array.from(debrief.querySelectorAll(".b6-pill")).map((p) => p.textContent);
    expect(pills).toEqual(["Yes", "No", "Unverified", "Open"]);
    expect(Array.from(debrief.querySelectorAll("q")).map((q) => q.textContent)).toEqual([
      "a customer asked at the display",
      "no time was written on the tray",
    ]);
    expect(screen.getByRole("list", { name: "Work notes" }).textContent).not.toContain("a customer asked at the display");
  });

  it("the Staff debrief section does not follow the category filter", () => {
    renderView(FILLED);
    fireEvent.click(screen.getByRole("button", { name: /Customer service/ }));
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(within(screen.getByRole("region", { name: "Staff debrief" })).getAllByRole("listitem")).toHaveLength(4);
  });

  it("only the reviewable row offers actions; the pill on it reads 'Needs your check'", () => {
    renderView(FILLED);
    expect(screen.getAllByRole("button", { name: "Confirm" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Change label" })).toHaveLength(1);
    const notes = screen.getByRole("list", { name: "Work notes" });
    expect(within(notes).getByText("Needs your check")).not.toBeNull();
    expect(within(notes).getByText("Auto-labelled")).not.toBeNull();
  });

  it("an empty supervisor day shows the empty state and no tiles, filter or Staff debrief", () => {
    renderView({ view: "supervisor", day: SUPERVISOR_HEADER, threads: [], unlabelled: [] });
    expect(screen.queryByRole("list", { name: "Day summary" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Filter by category" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Staff debrief" })).toBeNull();
    expect(screen.getByText("No notes for this day yet.")).not.toBeNull();
  });
});
