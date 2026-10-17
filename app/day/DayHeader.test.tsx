// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LangProvider } from "@/lib/i18n/context";
import type { OwnerDayHeader, SupervisorDayHeader } from "@/lib/day/contract";
import { DayHeader } from "@/app/day/DayHeader";

/**
 * R-25 T9 (board D2-02): the header is the title, the sub line and the date control. The in-page link list
 * (Proposals / SOP and changes / Reviews / Waiting for review / Home) is gone because the nav row carries the
 * routes; the facts/questions and capture-mode lines are gone because the tiles carry the numbers.
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

function renderHeader(
  view: "owner" | "supervisor",
  day: OwnerDayHeader | SupervisorDayHeader,
  handlers: { onPrev?: () => void; onNext?: () => void } = {},
  lang: "en" | "id" = "en",
) {
  return render(
    <LangProvider initial={lang}>
      <DayHeader
        view={view}
        day={day}
        threadCount={7}
        onPrev={handlers.onPrev ?? (() => {})}
        onNext={handlers.onNext ?? (() => {})}
      />
    </LangProvider>,
  );
}

describe("DayHeader — title and date control", () => {
  it("renders the page h1 'Day record' and the board sub line", () => {
    const { container } = renderHeader("supervisor", SUPERVISOR_HEADER);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("Day record");
    expect(h1.className).toContain("b6-h1-web");
    expect(container.textContent).toContain("What happened on the shop day, with the words behind it.");
  });

  it("shows the real business date, in the dayLabel format, as a <time> in the date control", () => {
    renderHeader("owner", OWNER_HEADER);
    const group = screen.getByRole("group", { name: "Choose a day" });
    const time = group.querySelector("time") as HTMLTimeElement;
    expect(time.getAttribute("datetime")).toBe("2026-10-08");
    expect(time.textContent).toBe("Thu 8 Oct");
  });

  it("the arrows keep their aria-labels and call onPrev / onNext", () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    renderHeader("supervisor", SUPERVISOR_HEADER, { onPrev, onNext });
    fireEvent.click(screen.getByRole("button", { name: "Previous day" }));
    fireEvent.click(screen.getByRole("button", { name: "Next day" }));
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("disables Next day on today (and only then)", () => {
    renderHeader("supervisor", { ...SUPERVISOR_HEADER, date: "2026-10-09" });
    expect((screen.getByRole("button", { name: "Next day" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Previous day" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("re-labels in Bahasa", () => {
    renderHeader("supervisor", SUPERVISOR_HEADER, {}, "id");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Catatan hari");
    expect(screen.getByRole("button", { name: "Hari sebelumnya" })).not.toBeNull();
    expect(screen.getByRole("group", { name: "Pilih hari" })).not.toBeNull();
  });
});

describe("DayHeader — removed legacy lines and links (R-25 T9, ruling R16)", () => {
  it.each([
    ["owner", OWNER_HEADER],
    ["supervisor", SUPERVISOR_HEADER],
  ] as const)("%s view renders no in-page links at all", (view, header) => {
    renderHeader(view, header);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it.each([
    ["owner", OWNER_HEADER],
    ["supervisor", SUPERVISOR_HEADER],
  ] as const)("%s view shows no 'Facts / Questions' counts line and no 'Mode' line", (view, header) => {
    const { container } = renderHeader(view, header);
    expect(container.textContent).not.toContain("Facts:");
    expect(container.textContent).not.toContain("Questions:");
    expect(container.textContent).not.toContain("Mode:");
  });
});

describe("DayHeader — status lines that stay", () => {
  it("closed and off days say so", () => {
    for (const day_status of ["closed", "off"] as const) {
      const { container, unmount } = renderHeader("supervisor", { ...SUPERVISOR_HEADER, day_status });
      expect(container.textContent).toContain("Off / closed");
      unmount();
    }
  });

  it("a pending day says it has not started", () => {
    const { container } = renderHeader("supervisor", { ...SUPERVISOR_HEADER, day_status: "pending" });
    expect(container.textContent).toContain("Not started yet");
  });

  it("an on day shows neither line", () => {
    const { container } = renderHeader("supervisor", SUPERVISOR_HEADER);
    expect(container.textContent).not.toContain("Off / closed");
    expect(container.textContent).not.toContain("Not started yet");
  });

  it("cancelled sessions and a truncated list are stated", () => {
    const { container } = renderHeader("supervisor", { ...SUPERVISOR_HEADER, sessions_cancelled: 2, truncated: true });
    expect(container.textContent).toContain("Sessions cancelled: 2");
    expect(container.textContent).toContain("Showing the first 7 notes.");
  });
});
