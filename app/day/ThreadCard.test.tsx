// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LangProvider } from "@/lib/i18n/context";
import type { OwnerThread, SupervisorThread } from "@/lib/day/contract";
import type { Auth } from "@/lib/auth/client/firebase-client";
import { ThreadCard } from "@/app/day/ThreadCard";

afterEach(() => {
  cleanup();
});

const OWNER_THREAD: OwnerThread = {
  row: 0,
  category: "ROUTINE_OPS",
  start_hm: "10:00",
  end_hm: "10:05",
  summary: "Checked the oven.",
  confidence_pct: 90,
  display_status: "fact",
};

const SUPERVISOR_THREAD: SupervisorThread = {
  row: 0,
  category: "COMPLAINT",
  start_hm: "10:00",
  end_hm: "10:05",
  summary: "A customer complained about the wait.",
  confidence_pct: 70,
  display_status: "awaiting_supervisor",
  evidence: [
    { hm: "10:01", text: "EVID-1" },
    { hm: "10:02", text: "EVID-2" },
  ],
  evidence_more: 5,
  staff_answer: null,
  runner_up: null,
  handle: null,
  can_review: false,
};

function renderOwner(thread: OwnerThread = OWNER_THREAD) {
  return render(
    <LangProvider initial="en">
      <ThreadCard view="owner" thread={thread} />
    </LangProvider>,
  );
}

function renderSupervisor(thread: SupervisorThread = SUPERVISOR_THREAD) {
  return render(
    <LangProvider initial="en">
      <ThreadCard
        view="supervisor"
        thread={thread}
        onReload={() => {}}
        auth={{} as Auth}
      />
    </LangProvider>,
  );
}

describe("ThreadCard — owner", () => {
  it("never renders a blockquote, q or button", () => {
    const { container } = renderOwner();
    expect(container.querySelector("blockquote")).toBeNull();
    expect(container.querySelector("q")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });

  it("shows the time, category, status and summary", () => {
    const { container } = renderOwner();
    expect(container.textContent).toContain("10:00");
    expect(container.textContent).toContain("10:05");
    expect(container.textContent).toContain("Routine work");
    expect(container.textContent).toContain("Auto-labelled");
    expect(container.textContent).toContain("Checked the oven.");
  });

  it("shows the three-letter category chip next to the summary, with the full name on the chip and in the meta line", () => {
    const { container } = renderOwner();
    const chip = container.querySelector(".b6-chip") as HTMLElement;
    expect(chip.textContent).toBe("RTN");
    expect(chip.getAttribute("title")).toBe("Routine work");
    expect(container.textContent).toContain("Confidence 90% \u00B7 Routine work");
  });

  it("puts the start time in the time column and keeps the end time for screen readers", () => {
    const { container } = renderOwner();
    const time = container.querySelector(".b6-mono") as HTMLElement;
    expect(time.firstChild?.textContent).toBe("10:00");
    expect(time.querySelector(".b6-sr-only")?.textContent).toBe("\u201310:05");
  });

  it("shows C-day-no-summary when the summary is blank", () => {
    const { container } = renderOwner({ ...OWNER_THREAD, summary: "   " });
    expect(container.textContent).toContain("No summary.");
  });
});

describe("ThreadCard — supervisor actions gating (Task 10)", () => {
  it("can_review: false renders no ThreadActions buttons", () => {
    const { container } = renderSupervisor({ ...SUPERVISOR_THREAD, can_review: false, handle: null });
    expect(container.querySelector("button")).toBeNull();
  });

  it("can_review: true with a handle renders the Confirm / Change label buttons", () => {
    const { container } = renderSupervisor({
      ...SUPERVISOR_THREAD,
      can_review: true,
      handle: "HANDLE-SENTINEL",
    });
    expect(container.textContent).toContain("Confirm");
    expect(container.textContent).toContain("Change label");
  });
});

describe("ThreadCard — supervisor", () => {
  it("shows evidence lines in order and the +N more line", () => {
    const { container } = renderSupervisor();
    const quotes = Array.from(container.querySelectorAll("blockquote")).map((el) => el.textContent);
    expect(quotes).toEqual(["10:01\u201CEVID-1\u201D", "10:02\u201CEVID-2\u201D"]);
    expect(container.textContent).toContain("+5 more lines");
  });

  it("does not render an evidence heading when there is no evidence", () => {
    const { container } = renderSupervisor({ ...SUPERVISOR_THREAD, evidence: [], evidence_more: 0 });
    expect(container.querySelector("blockquote")).toBeNull();
    expect(container.textContent).not.toContain("Evidence");
  });

  it("never shows the staff answer on the card: it is listed in the Staff debrief section (R-25 T9)", () => {
    const { container } = renderSupervisor({
      ...SUPERVISOR_THREAD,
      staff_answer: { answer: "no", reason: "Forgot the step." },
    });
    expect(container.textContent).not.toContain("A staff member answered");
    expect(container.textContent).not.toContain("Forgot the step.");
    expect(container.querySelector("q")).toBeNull();
  });
});

describe("ThreadCard — status pill (board D2-02)", () => {
  const REVIEWABLE: SupervisorThread = {
    ...SUPERVISOR_THREAD,
    staff_answer: { answer: "yes", reason: null },
    can_review: true,
    handle: "HANDLE-SENTINEL",
  };

  it("a reviewable row that is not a fact yet reads 'Needs your check' in the amber pill", () => {
    const { container } = renderSupervisor(REVIEWABLE);
    const pill = container.querySelector(".b6-pill") as HTMLElement;
    expect(pill.textContent).toBe("Needs your check");
    expect(pill.className).toContain("b6-pill--amber");
  });

  it("a row the supervisor cannot review keeps its own status words, with no check pill", () => {
    const { container } = renderSupervisor({ ...SUPERVISOR_THREAD, display_status: "question_open" });
    const pill = container.querySelector(".b6-pill") as HTMLElement;
    expect(pill.textContent).toBe("Question, waiting for the debrief");
    expect(pill.className).toContain("b6-pill--neutral");
  });

  it("a supervisor-confirmed fact is green and offers no Confirm button", () => {
    const { container } = renderSupervisor({ ...REVIEWABLE, display_status: "fact_supervisor_confirmed" });
    const pill = container.querySelector(".b6-pill") as HTMLElement;
    expect(pill.textContent).toBe("Fact, confirmed by supervisor");
    expect(pill.className).toContain("b6-pill--green");
    expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
  });

  it("a plain fact reads 'Auto-labelled' (neutral)", () => {
    const { container } = renderSupervisor({ ...SUPERVISOR_THREAD, display_status: "fact" });
    const pill = container.querySelector(".b6-pill") as HTMLElement;
    expect(pill.textContent).toBe("Auto-labelled");
    expect(pill.className).toContain("b6-pill--neutral");
  });

  it("renders the Change label / Confirm actions inside the row, after the pill", () => {
    const { container } = renderSupervisor(REVIEWABLE);
    const pill = container.querySelector(".b6-pill") as HTMLElement;
    const confirm = screen.getByRole("button", { name: "Confirm" });
    expect(pill.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change label" })).not.toBeNull();
  });
});

describe("ThreadCard — runner-up panel (Task 11)", () => {
  it("renders one details with the second-choice summary and the why_not body", () => {
    const { container } = renderSupervisor({
      ...SUPERVISOR_THREAD,
      runner_up: { category: "CUSTOMER_SERVICE", why_not: "RUNUP-SENTINEL-1" },
    });
    const details = container.querySelectorAll("details");
    expect(details).toHaveLength(1);
    expect(details[0]!.querySelector("summary")!.textContent).toBe(
      "Second choice: Customer service",
    );
    expect(details[0]!.textContent).toContain("RUNUP-SENTINEL-1");
  });

  it("shows 'No reason given.' when why_not is null", () => {
    const { container } = renderSupervisor({
      ...SUPERVISOR_THREAD,
      runner_up: { category: "ROUTINE_OPS", why_not: null },
    });
    expect(container.textContent).toContain("No reason given.");
  });

  it("renders no details when runner_up is null", () => {
    const { container } = renderSupervisor({ ...SUPERVISOR_THREAD, runner_up: null });
    expect(container.querySelector("details")).toBeNull();
  });

  it("owner card never renders a details, regardless of any stray data", () => {
    const { container } = renderOwner();
    expect(container.querySelector("details")).toBeNull();
  });

  it("switches language for the runner-up summary, keeping the body untranslated", () => {
    const { container } = render(
      <LangProvider initial="id">
        <ThreadCard
          view="supervisor"
          thread={{
            ...SUPERVISOR_THREAD,
            runner_up: { category: "CUSTOMER_SERVICE", why_not: "fixed body text" },
          }}
          onReload={() => {}}
          auth={{} as Auth}
        />
      </LangProvider>,
    );
    expect(container.querySelector("summary")!.textContent).toBe("Pilihan kedua: Layanan pelanggan");
    expect(container.textContent).toContain("fixed body text");
  });
});
