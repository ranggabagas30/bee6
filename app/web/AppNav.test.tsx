// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
    const last = links()[3];
    fireEvent.focus(last);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ inline: "nearest", block: "nearest" });
    expect(scrollIntoView.mock.contexts[0]).toBe(last);
  });

  it("the nav CSS shows an edge fade when it overflows on a phone and keeps the focused item clear of it", () => {
    const css = readFileSync(join(__dirname, "shell.module.css"), "utf8");
    const nav = css.match(/\n\.nav\s*{[^}]*}/)?.[0] ?? "";
    expect(nav).toMatch(/mask-image:\s*linear-gradient\(to right/);
    expect(nav).toMatch(/scroll-padding-inline:/);
    // From 900 px the nav wraps instead of scrolling, so the fade is dropped there.
    expect(css.slice(css.indexOf("@media (min-width: 900px)"))).toMatch(/mask-image:\s*none/);
  });
});
