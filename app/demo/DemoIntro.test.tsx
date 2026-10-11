// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LangProvider } from "@/lib/i18n/context";
import { DemoIntro } from "@/app/demo/DemoIntro";

afterEach(cleanup);

function renderIntro(lang: "en" | "id" = "en") {
  return render(
    <LangProvider initial={lang}>
      <DemoIntro />
    </LangProvider>,
  );
}

describe("DemoIntro (the demo home page's text above the sign-in)", () => {
  it("shows the title, the intro, the suggested path and the fictional-data line in English, with no Try wording", () => {
    renderIntro();
    expect(screen.getByRole("heading", { level: 1, name: "bee6: the SOP Improvement Agent" })).toBeTruthy();
    expect(screen.getByText(/This demo shop is fictional/)).toBeTruthy();
    expect(screen.getByText("Suggested path: sign in as Staff and speak a short shop day, answer the debrief, then switch to Supervisor and Owner from the bar at the top.")).toBeTruthy();
    expect(screen.getByText("Fictional demo data")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\btry\b/i);
  });

  it("is in Bahasa when the language says so", () => {
    renderIntro("id");
    expect(screen.getByRole("heading", { level: 1, name: "bee6: Agen Perbaikan SOP" })).toBeTruthy();
    expect(screen.getByText("Data demo fiktif")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\bcoba\b/i);
  });

  it("has no buttons or links of its own: the sign-in below is the only way in", () => {
    renderIntro();
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(screen.queryAllByRole("link")).toEqual([]);
  });
});
