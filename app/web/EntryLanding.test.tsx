// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { LangProvider } from "@/lib/i18n/context";
import { axeViolations } from "@/lib/testing/axe";
import { EntryLanding } from "@/app/web/EntryLanding";

afterEach(cleanup);

function renderLanding(lang: "en" | "id" = "en") {
  return render(
    <LangProvider initial={lang}>
      <EntryLanding />
    </LangProvider>,
  );
}
const roleLinks = () => screen.getAllByRole("link").filter((l) => /^\/(pair|sign-in)/.test(l.getAttribute("href") ?? ""));
const cards = () => screen.getAllByRole("article");
const css = () => readFileSync(join(__dirname, "entry.module.css"), "utf8");

describe("EntryLanding: the demo entry page (R-25 T3, boards P2-01 and D2-01)", () => {
  it("phone DOM order: header, outlet line, strip chip, h1, kicker, then the three cards", () => {
    renderLanding();
    const header = screen.getByRole("banner");
    const outlet = screen.getByText("Demo Bakery · Outlet 1");
    const strip = screen.getByText("DEMO OUTLET · FICTIONAL DATA");
    const h1 = screen.getByRole("heading", { level: 1, name: "A small shop's day, turned into one better SOP step at a time." });
    const kicker = screen.getByText("TRY ALL THREE ROLES · ABOUT 20 MINUTES");
    const [first] = cards();
    const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(header, outlet)).toBe(true);
    expect(follows(outlet, strip)).toBe(true);
    expect(follows(strip, h1)).toBe(true);
    expect(follows(h1, kicker)).toBe(true);
    expect(follows(kicker, first!)).toBe(true);
    expect(within(header).getByText("Bee6")).toBeTruthy();
    expect(within(header).getByRole("group", { name: "Choose language" })).toBeTruthy();
  });

  it("uses the shared primitives: entry h1, line chip, kick", () => {
    renderLanding();
    expect(screen.getByRole("heading", { level: 1 }).className).toContain("b6-h1-entry");
    expect(screen.getByText("DEMO OUTLET · FICTIONAL DATA").className).toContain("b6-chip--line");
    expect(screen.getByText("TRY ALL THREE ROLES · ABOUT 20 MINUTES").className).toContain("b6-kick");
  });

  it("has exactly three role cards in order: kicker, title, the board line, and a button-looking link inside", () => {
    renderLanding();
    const [staff, supervisor, owner] = cards();
    expect(cards()).toHaveLength(3);

    const expected = [
      [staff!, "STEP 1", "Try as Staff", "Start listening on the connected device, run the day, answer the closing questions.", "Open staff screen"],
      [supervisor!, "STEP 2", "Try as Supervisor", "See the day with evidence, then mark a proposal feasible or reject it with a reason.", "Open supervisor view"],
      [owner!, "STEP 3", "Try as Owner", "Approve or reject the change and see the new SOP version.", "Open owner view"],
    ] as const;
    for (const [card, step, title, line, open] of expected) {
      expect(within(card).getByText(step).className).toContain("b6-kick");
      expect(within(card).getByRole("heading", { level: 2, name: title })).toBeTruthy();
      expect(within(card).getByText(line)).toBeTruthy();
      expect(within(card).getByRole("link", { name: open })).toBeTruthy();
    }
  });

  it("Staff goes to /pair, Supervisor and Owner to the role sign-in; only the button is a link (the card is not)", () => {
    renderLanding();
    const links = roleLinks();
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/pair", "/sign-in?as=supervisor", "/sign-in?as=owner"]);
    for (const card of cards()) expect(within(card).getAllByRole("link")).toHaveLength(1);
    cards().forEach((card, i) => expect(card.contains(links[i]!)).toBe(true));
  });

  it("the Staff button is the primary look, the other two are the secondary look", () => {
    renderLanding();
    const [staff, supervisor, owner] = roleLinks();
    expect(staff!.className).toContain("b6-btn--primary");
    expect(staff!.className).toContain("b6-btn--lg");
    expect(supervisor!.className).toContain("b6-btn--secondary");
    expect(owner!.className).toContain("b6-btn--secondary");
  });

  it("drops START HERE and Best on a phone (not on the board), and the page CSS has no teal ring or raw colour", () => {
    renderLanding();
    expect(screen.queryByText("START HERE")).toBeNull();
    expect(screen.queryByText("Best on a phone")).toBeNull();
    expect(css()).not.toMatch(/inset 0 0 0 2px var\(--b6-teal\)/);
    expect(css()).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("the STEP kick does not grow inside the card column, so a stretched card keeps its button at the foot", () => {
    expect(css()).toMatch(/\.card > :global\(\.b6-kick\)\s*{\s*flex:\s*none;/);
  });

  it("the fictional-data note is in the footer and the CSS hides it below 600 px", () => {
    renderLanding();
    expect(screen.getByRole("contentinfo").textContent).toContain(
      "Fictional shop, fictional data. Real shop data lives in a separate system and can't be reached from this demo. Sessions last 2 hours.",
    );
    expect(css()).toMatch(/\.footer\s*{[^}]*display:\s*none/);
    expect(css()).toMatch(/@media \(min-width: 600px\)\s*{\s*\.footer\s*{\s*display:\s*block/);
  });

  it("the laptop bar is the shared .b6-dtop row with the DEMO DATA chip; every card has a decorative preview", () => {
    renderLanding();
    const banner = screen.getByRole("banner");
    expect(banner.className).toContain("b6-dtop");
    expect(within(banner).getByText("DEMO DATA")).toBeTruthy();
    for (const card of cards()) expect(card.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it("never shows the demo code, the credentials or the change-role tip: those live in the judge guide (W8)", () => {
    renderLanding();
    expect(document.body.textContent).not.toMatch(/000000|example\.com|bee6-demo|change role|sign out|password/i);
    expect(screen.queryAllByRole("button").filter((b) => !/^(ID|EN)\b/.test(b.textContent ?? ""))).toEqual([]);
  });

  it("is in Bahasa when the language says so", () => {
    renderLanding("id");
    expect(screen.getByText("OUTLET DEMO · DATA FIKTIF")).toBeTruthy();
    expect(screen.getByText("Demo Bakery · Outlet 1")).toBeTruthy();
    const [staff, supervisor, owner] = cards();
    expect(within(staff!).getByRole("heading", { name: "Coba sebagai Staf" })).toBeTruthy();
    expect(within(supervisor!).getByRole("heading", { name: "Coba sebagai Supervisor" })).toBeTruthy();
    expect(within(owner!).getByRole("heading", { name: "Coba sebagai Pemilik" })).toBeTruthy();
    expect(within(staff!).getByRole("link", { name: "Buka layar staf" })).toBeTruthy();
    expect(within(supervisor!).getByRole("link", { name: "Buka tampilan supervisor" })).toBeTruthy();
    expect(within(owner!).getByRole("link", { name: "Buka tampilan pemilik" })).toBeTruthy();
    expect(screen.queryByText("MULAI DI SINI")).toBeNull();
  });

  it("axe finds no violation", async () => {
    const { container } = renderLanding();
    expect(await axeViolations(container)).toEqual([]);
  });
});
