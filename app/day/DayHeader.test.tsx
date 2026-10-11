// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LangProvider } from "@/lib/i18n/context";
import type { OwnerDayHeader, SupervisorDayHeader } from "@/lib/day/contract";
import { DayHeader } from "@/app/day/DayHeader";

/**
 * R-06 Task 13: the `C-day-to-queue` link (supervisor only), isolated from
 * `DayRecordView.test.tsx` — that file is concurrently edited by PR-6
 * (Task 12, unlabelled moments), so this task (13) does not touch it.
 */

afterEach(() => {
  cleanup();
});

const OWNER_HEADER: OwnerDayHeader = {
  date: "2026-10-08",
  today: "2026-10-09",
  day_status: "on",
  sessions_cancelled: 0,
  capture_mode: "room",
  fact_count: 4,
  truncated: false,
};

const SUPERVISOR_HEADER: SupervisorDayHeader = { ...OWNER_HEADER, question_count: 3 };

function renderHeader(view: "owner" | "supervisor", day: OwnerDayHeader | SupervisorDayHeader) {
  return render(
    <LangProvider initial="en">
      <DayHeader view={view} day={day} threadCount={0} onPrev={() => {}} onNext={() => {}} />
    </LangProvider>,
  );
}

describe("DayHeader — queue link (R-06 Task 13)", () => {
  it("supervisor view shows a link to /questions", () => {
    renderHeader("supervisor", SUPERVISOR_HEADER);
    const link = screen.getByRole("link", { name: "Waiting for review" });
    expect(link.getAttribute("href")).toBe("/questions");
  });

  it("the queue link meets the 48px touch-target minimum (CLAUDE.md §2 global constraint)", () => {
    renderHeader("supervisor", SUPERVISOR_HEADER);
    const link = screen.getByRole("link", { name: "Waiting for review" }) as HTMLAnchorElement;
    expect(link.style.minHeight).toBe("48px");
  });

  it("owner view shows no queue link", () => {
    renderHeader("owner", OWNER_HEADER);
    expect(screen.queryByRole("link", { name: "Waiting for review" })).toBeNull();
  });

  it("owner view still shows the Home link (unchanged by Task 13)", () => {
    renderHeader("owner", OWNER_HEADER);
    const link = screen.getByRole("link", { name: "Home" });
    expect(link.getAttribute("href")).toBe("/home");
  });

  it("supervisor view shows no Home link", () => {
    renderHeader("supervisor", SUPERVISOR_HEADER);
    expect(screen.queryByRole("link", { name: "Home" })).toBeNull();
  });
});

describe("DayHeader — proposals link (R-08 Task 7.5)", () => {
  it("owner view shows a link to /proposals", () => {
    renderHeader("owner", OWNER_HEADER);
    const link = screen.getByRole("link", { name: "Proposals" });
    expect(link.getAttribute("href")).toBe("/proposals");
  });

  it("supervisor view shows a link to /proposals", () => {
    renderHeader("supervisor", SUPERVISOR_HEADER);
    const link = screen.getByRole("link", { name: "Proposals" });
    expect(link.getAttribute("href")).toBe("/proposals");
  });

  it("the proposals link meets the 48px touch-target minimum", () => {
    renderHeader("owner", OWNER_HEADER);
    const link = screen.getByRole("link", { name: "Proposals" }) as HTMLAnchorElement;
    expect(link.style.minHeight).toBe("48px");
  });
});

describe("DayHeader — SOP link (R-10 Task 5.5)", () => {
  it.each([
    ["owner", OWNER_HEADER],
    ["supervisor", SUPERVISOR_HEADER],
  ] as const)("%s view shows a 48px link to /sop", (view, header) => {
    renderHeader(view, header);
    const link = screen.getByRole("link", { name: "SOP and changes" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/sop");
    expect(link.style.minHeight).toBe("48px");
  });
});
