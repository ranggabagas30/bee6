// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
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
    expect(container.textContent).toContain("Fact");
    expect(container.textContent).toContain("Checked the oven.");
  });

  it("shows C-day-no-summary when the summary is blank", () => {
    const { container } = renderOwner({ ...OWNER_THREAD, summary: "   " });
    expect(container.textContent).toContain("No summary.");
  });
});

describe("ThreadCard — supervisor", () => {
  it("shows evidence lines in order and the +N more line", () => {
    const { container } = renderSupervisor();
    const quotes = Array.from(container.querySelectorAll("blockquote")).map((el) => el.textContent);
    expect(quotes).toEqual(["10:01 «EVID-1»", "10:02 «EVID-2»"]);
    expect(container.textContent).toContain("+5 more lines");
  });

  it("does not render an evidence heading when there is no evidence", () => {
    const { container } = renderSupervisor({ ...SUPERVISOR_THREAD, evidence: [], evidence_more: 0 });
    expect(container.querySelector("blockquote")).toBeNull();
    expect(container.textContent).not.toContain("Evidence");
  });

  it("shows the Yes answer without a quote when the reason is null", () => {
    const { container } = renderSupervisor({
      ...SUPERVISOR_THREAD,
      staff_answer: { answer: "yes", reason: null },
    });
    expect(container.textContent).toContain("A staff member answered Yes:");
    expect(container.querySelector("q")).toBeNull();
  });

  it("shows the No answer with the reason in a quote", () => {
    const { container } = renderSupervisor({
      ...SUPERVISOR_THREAD,
      staff_answer: { answer: "no", reason: "Forgot the step." },
    });
    expect(container.textContent).toContain("A staff member answered No:");
    expect(container.querySelector("q")?.textContent).toBe("Forgot the step.");
  });

  it("renders no staff-answer line when staff_answer is null", () => {
    const { container } = renderSupervisor({ ...SUPERVISOR_THREAD, staff_answer: null });
    expect(container.textContent).not.toContain("A staff member answered");
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
