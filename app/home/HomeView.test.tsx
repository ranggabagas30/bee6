// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LangProvider, useLang } from "@/lib/i18n/context";
import type { HomeResponse } from "@/lib/home/contract";
import { HomeView } from "@/app/home/HomeView";

afterEach(() => {
  cleanup();
});

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
    ...overrides,
  };
}

function renderView(data: HomeResponse, initial: "en" | "id" = "en") {
  return render(
    <LangProvider initial={initial}>
      <HomeView data={data} />
    </LangProvider>,
  );
}

describe("HomeView", () => {
  it("renders lines in order, with the category label, no blockquote/q/button", () => {
    const { container } = renderView(baseData());
    const text = container.textContent ?? "";
    expect(text.indexOf("FACT-1")).toBeLessThan(text.indexOf("FACT-2"));
    expect(text).toContain("09:00");
    expect(text).toContain("Routine work");
    expect(text).toContain("Customer complaint");
    expect(container.querySelector("blockquote")).toBeNull();
    expect(container.querySelector("q")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });

  it("more > 0 shows '+N more in the day record' linking to /day/<today>", () => {
    renderView(baseData({ more: 4 }));
    const link = screen.getByRole("link", { name: "+4 more in the day record" });
    expect(link.getAttribute("href")).toBe("/day/2026-10-09");
  });

  it("the '+N more' link meets the 48px touch-target minimum (CLAUDE.md §2 global constraint)", () => {
    renderView(baseData({ more: 4 }));
    const link = screen.getByRole("link", { name: "+4 more in the day record" }) as HTMLAnchorElement;
    expect(link.style.minHeight).toBe("48px");
  });

  it("more === 0 shows no '+N more' link", () => {
    renderView(baseData({ more: 0 }));
    expect(screen.queryByText(/more in the day record/)).toBeNull();
  });

  it("always shows a link to /proposals, at least 48px tall (R-09 8.5)", () => {
    renderView(baseData());
    const link = screen.getByRole("link", { name: "Proposals" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/proposals");
    expect(link.style.minHeight).toBe("48px");
  });

  it("the proposals link reads in Bahasa when the language is Bahasa", () => {
    renderView(baseData(), "id");
    expect(screen.getByRole("link", { name: "Usulan" }).getAttribute("href")).toBe("/proposals");
  });

  it("always shows a link to the day record", () => {
    renderView(baseData());
    const link = screen.getByRole("link", { name: "Open the day record" });
    expect(link.getAttribute("href")).toBe("/day/2026-10-09");
  });

  it("the 'Open the day record' link meets the 48px touch-target minimum (CLAUDE.md §2 global constraint)", () => {
    renderView(baseData());
    const link = screen.getByRole("link", { name: "Open the day record" }) as HTMLAnchorElement;
    expect(link.style.minHeight).toBe("48px");
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
        <HomeView data={baseData()} />
      </LangProvider>,
    );
    expect(screen.getByText("Today")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "toggle-lang" }));
    expect(screen.getByText("Hari ini")).not.toBeNull();
    expect(screen.getByText("FACT-1")).not.toBeNull();
  });
});
