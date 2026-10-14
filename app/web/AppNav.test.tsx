// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { LangProvider } from "@/lib/i18n/context";
import { axeViolations } from "@/lib/testing/axe";
import { AppNav, NAV, type NavItemId } from "@/app/web/AppNav";

afterEach(cleanup);

function renderNav(role: "supervisor" | "owner", current?: NavItemId, lang: "en" | "id" = "en") {
  return render(
    <LangProvider initial={lang}>
      <AppNav role={role} current={current} />
    </LangProvider>,
  );
}
const links = () => within(screen.getByRole("navigation", { name: /Main|Menu utama/ })).getAllByRole("link");
const names = () => links().map((l) => l.textContent);
const hrefs = () => links().map((l) => l.getAttribute("href"));

describe("AppNav (R-19 PR-6 §8.2, D-9)", () => {
  it("NAV is exactly the decided item lists, with no Team item", () => {
    expect(NAV.supervisor).toEqual(["day", "proposals", "sop", "reviews", "devices"]);
    expect(NAV.owner).toEqual(["home", "proposals", "sop", "reviews"]);
  });

  it("supervisor: Day record, Proposals, SOP, Reviews, Connected devices in that order", () => {
    renderNav("supervisor");
    expect(names()).toEqual(["Day record", "Proposals", "SOP", "Reviews", "Connected devices"]);
    expect(hrefs()).toEqual(["/day", "/proposals", "/sop", "/reviews", "/devices"]);
  });

  it("owner: Home, Approvals (the proposals page), SOP, Reviews; no devices, no Team", () => {
    renderNav("owner");
    expect(names()).toEqual(["Home", "Approvals", "SOP", "Reviews"]);
    expect(hrefs()).toEqual(["/home", "/proposals", "/sop", "/reviews"]);
    expect(screen.queryByText(/team/i)).toBeNull();
  });

  it("marks the current item with aria-current=page and nothing else", () => {
    renderNav("supervisor", "sop");
    const current = links().filter((l) => l.getAttribute("aria-current") === "page");
    expect(current.map((l) => l.textContent)).toEqual(["SOP"]);
  });

  it("marks nothing when the page is not in the nav (the review queue)", () => {
    renderNav("supervisor");
    expect(links().filter((l) => l.hasAttribute("aria-current"))).toEqual([]);
  });

  it("is in Bahasa when the language says so", () => {
    renderNav("owner", "home", "id");
    expect(screen.getByRole("navigation", { name: "Menu utama" })).toBeTruthy();
    expect(names()).toEqual(["Beranda", "Persetujuan", "SOP", "Tinjauan"]);
  });

  it("axe finds no violation", async () => {
    const { container } = renderNav("supervisor", "day");
    expect(await axeViolations(container)).toEqual([]);
  });
  it("scrolls a focused link into view, so a partly visible item is not left clipped (keyboard, 360 px)", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    renderNav("owner", "home", "id");
    const last = links()[3]!;
    fireEvent.focus(last);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ inline: "nearest", block: "nearest" });
    expect(scrollIntoView.mock.contexts[0]).toBe(last as unknown);
  });

  it("the nav CSS fades only on request (data-fade), keeps the focus ring clear, and drops the fade from 900 px", () => {
    const css = readFileSync(join(__dirname, "shell.module.css"), "utf8");
    const nav = css.match(/\n\.nav\s*{[^}]*}/)?.[0] ?? "";
    expect(nav).not.toMatch(/mask-image/); // never unconditional
    expect(nav).toMatch(/scroll-padding-inline:/);
    expect(css).toMatch(/\.nav\[data-fade="true"\]\s*{[^}]*mask-image:\s*linear-gradient\(to right/);
    // The nav scrolls (overflow clips both axes), so its vertical room must hold the 2 px ring + 2 px offset + the list's 2 px.
    const padTop = Number(nav.match(/padding:\s*(\d+)px/)?.[1] ?? 0);
    const listPad = Number(css.match(/\.navList\s*{[^}]*?padding:\s*(\d+)px/)?.[1] ?? 0);
    const ring = css.match(/\.navLink:focus-visible\s*{[^}]*}/)?.[0] ?? "";
    const width = Number(ring.match(/outline:\s*(\d+)px/)?.[1]);
    const offset = Number(ring.match(/outline-offset:\s*(-?\d+)px/)?.[1]);
    expect(padTop + listPad).toBeGreaterThanOrEqual(Math.max(0, width + offset));
    // From 900 px the nav wraps instead of scrolling, so the fade is dropped there.
    const wide = css.slice(css.indexOf("@media (min-width: 900px)"));
    expect(wide).toMatch(/mask-image:\s*none/);
    // ...and it no longer scrolls there, so it must not keep clipping the focus ring either.
    expect(wide.match(/\.nav\s*{[^}]*}/)?.[0]).toMatch(/overflow:\s*visible/);
  });
});

describe("AppNav edge fade states (R-19 PR-6 defect 3)", () => {
  function stubLayout(scrollWidth: number, clientWidth: number) {
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(scrollWidth);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(clientWidth);
  }
  const navEl = () => screen.getByRole("navigation", { name: /Main|Menu utama/ });
  afterEach(() => vi.restoreAllMocks());

  it("no overflow: no fade, the last item is never dimmed", () => {
    stubLayout(372, 372);
    renderNav("owner", "home");
    expect(navEl().getAttribute("data-fade")).toBe("false");
  });

  it("overflow and not scrolled to the end: fade", () => {
    stubLayout(500, 360);
    renderNav("supervisor", "day");
    expect(navEl().getAttribute("data-fade")).toBe("true");
  });

  it("scrolled to the end: no fade; scrolling back brings it back", () => {
    stubLayout(500, 360);
    renderNav("supervisor", "day");
    const el = navEl();
    el.scrollLeft = 140;
    act(() => {
      fireEvent.scroll(el);
    });
    expect(el.getAttribute("data-fade")).toBe("false");
    el.scrollLeft = 60;
    act(() => {
      fireEvent.scroll(el);
    });
    expect(el.getAttribute("data-fade")).toBe("true");
  });

  it("re-measures on window resize (rotate, or a wider phone)", () => {
    stubLayout(500, 360);
    renderNav("supervisor", "day");
    expect(navEl().getAttribute("data-fade")).toBe("true");
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(500);
    act(() => {
      fireEvent(window, new Event("resize"));
    });
    expect(navEl().getAttribute("data-fade")).toBe("false");
  });
});
