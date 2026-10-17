// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LangProvider, useLang } from "@/lib/i18n/context";
import type { SupervisorUnlabelled } from "@/lib/day/contract";
import { UnlabelledCard } from "@/app/day/UnlabelledCard";

afterEach(() => {
  cleanup();
});

const BASE: SupervisorUnlabelled = {
  key: 0,
  after_row: null,
  start_hm: "09:00",
  end_hm: "09:02",
  display_status: "question_open",
  staff_answer: null,
};

function renderCard(item: SupervisorUnlabelled = BASE, lang: "en" | "id" = "en") {
  return render(
    <LangProvider initial={lang}>
      <UnlabelledCard item={item} />
    </LangProvider>,
  );
}

describe("UnlabelledCard", () => {
  it("never renders a blockquote, q or button; has no confidence/evidence/runner-up text", () => {
    const { container } = renderCard();
    expect(container.querySelector("blockquote")).toBeNull();
    expect(container.querySelector("q")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).not.toContain("Confidence");
    expect(container.textContent).not.toContain("Evidence");
  });

  it("renders the time, the 'Not labelled' label, the status badge and the help text", () => {
    const { container } = renderCard({ ...BASE, start_hm: "11:00", end_hm: "11:02" });
    expect(container.textContent).toContain("11:00–11:02");
    expect(container.textContent).toContain("Not labelled");
    expect(container.textContent).toContain("Question, waiting for the debrief");
    expect(container.textContent).toContain("Could not label this. Staff were asked about it.");
  });

  it.each([
    ["question_open", "Question, waiting for the debrief"],
    ["question_answered", "Answered, not a fact yet"],
    ["unverified", "Unverified"],
  ] as const)("maps display_status %s to its status badge", (display_status, label) => {
    const { container } = renderCard({ ...BASE, display_status });
    expect(container.textContent).toContain(label);
  });

  it("does not render the staff answer on the card (it is listed in the Staff debrief section, R-25 T9)", () => {
    const { container } = renderCard({
      ...BASE,
      display_status: "question_answered",
      staff_answer: { answer: "no", reason: "UNL-REASON-SENTINEL" },
    });
    expect(container.textContent).not.toContain("A staff member answered");
    expect(container.textContent).not.toContain("UNL-REASON-SENTINEL");
    expect(container.querySelector("q")).toBeNull();
  });

  it("switching language re-labels the chrome", () => {
    function LangToggle() {
      const { setLang } = useLang();
      return (
        <button type="button" onClick={() => setLang("id")}>
          toggle-lang
        </button>
      );
    }
    const { container } = render(
      <LangProvider initial="en">
        <LangToggle />
        <UnlabelledCard item={BASE} />
      </LangProvider>,
    );
    expect(container.textContent).toContain("Not labelled");

    fireEvent.click(screen.getByRole("button", { name: "toggle-lang" }));

    expect(container.textContent).toContain("Belum berlabel");
  });

  it("is one row of the notes list: a time, a body and a status pill (board D2-02)", () => {
    const { container } = renderCard();
    const article = container.querySelector("article") as HTMLElement;
    expect(article.className).toMatch(/row/);
    expect(article.querySelector(".b6-mono")?.textContent).toContain("09:00");
    expect(article.querySelector(".b6-pill")).not.toBeNull();
  });
});
