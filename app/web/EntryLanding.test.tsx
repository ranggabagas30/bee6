// @vitest-environment jsdom
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

describe("EntryLanding: the demo entry page (R-19 PR-6 §8.1, page-1 W1 without the long paragraph, V4)", () => {
  it("shows the demo strip, the headline, the kicker and the footer line", () => {
    renderLanding();
    expect(screen.getByText("DEMO OUTLET · FICTIONAL DATA")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "A small shop's day, turned into one better SOP step at a time." })).toBeTruthy();
    expect(screen.getByText("TRY ALL THREE ROLES · ABOUT 20 MINUTES")).toBeTruthy();
    expect(screen.getByRole("contentinfo").textContent).toContain(
      "Fictional shop, fictional data. Real shop data lives in a separate system and can't be reached from this demo. Sessions last 2 hours.",
    );
  });

  it("has exactly three role cards, in order, each a link: Staff to /pair, Supervisor and Owner to the role sign-in", () => {
    renderLanding();
    const links = roleLinks();
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/pair", "/sign-in?as=supervisor", "/sign-in?as=owner"]);
    expect(within(links[0]!).getByText("STEP 1")).toBeTruthy();
    expect(within(links[0]!).getByRole("heading", { name: "Staff" })).toBeTruthy();
    expect(within(links[1]!).getByText("STEP 2")).toBeTruthy();
    expect(within(links[1]!).getByRole("heading", { name: "Supervisor" })).toBeTruthy();
    expect(within(links[2]!).getByText("STEP 3")).toBeTruthy();
    expect(within(links[2]!).getByRole("heading", { name: "Owner" })).toBeTruthy();
  });

  it("only the Staff card says START HERE and Best on a phone", () => {
    renderLanding();
    const [staff, supervisor, owner] = roleLinks();
    expect(within(staff!).getByText("START HERE")).toBeTruthy();
    expect(within(staff!).getByText("Best on a phone")).toBeTruthy();
    expect(within(supervisor!).queryByText("START HERE")).toBeNull();
    expect(within(owner!).queryByText(/phone/)).toBeNull();
  });

  it("never shows the demo code, the credentials or the change-role tip: those live in the judge guide (W8)", () => {
    renderLanding();
    expect(document.body.textContent).not.toMatch(/000000|example\.com|bee6-demo|change role|sign out|password/i);
    expect(screen.queryAllByRole("button").filter((b) => !/^(ID|EN)\b/.test(b.textContent ?? ""))).toEqual([]);
  });

  it("carries the ID | EN switch", () => {
    renderLanding();
    expect(screen.getByRole("group", { name: "Choose language" })).toBeTruthy();
  });

  it("is in Bahasa when the language says so", () => {
    renderLanding("id");
    expect(screen.getByText("OUTLET DEMO · DATA FIKTIF")).toBeTruthy();
    expect(screen.getByText("MULAI DI SINI")).toBeTruthy();
    expect(within(roleLinks()[2]!).getByRole("heading", { name: "Pemilik" })).toBeTruthy();
  });

  it("axe finds no violation", async () => {
    const { container } = renderLanding();
    expect(await axeViolations(container)).toEqual([]);
  });
});
