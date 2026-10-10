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

  it("renders a Yes answer without a <q> when reason is null", () => {
    const { container } = renderCard({
      ...BASE,
      display_status: "question_answered",
      staff_answer: { answer: "yes", reason: null },
    });
    expect(container.textContent).toContain("A staff member answered Yes:");
    expect(container.querySelector("q")).toBeNull();
  });

  it("renders a No answer with the reason in a <q>", () => {
    const { container } = renderCard({
      ...BASE,
      display_status: "question_answered",
      staff_answer: { answer: "no", reason: "UNL-REASON-SENTINEL" },
    });
    expect(container.textContent).toContain("A staff member answered No:");
    expect(container.querySelector("q")?.textContent).toBe("UNL-REASON-SENTINEL");
  });

  it("renders nothing staff-answer-shaped when staff_answer is null", () => {
    const { container } = renderCard({ ...BASE, staff_answer: null });
    expect(container.textContent).not.toContain("A staff member answered");
  });

  it("switching language keeps the staff reason byte-identical and re-labels the chrome", () => {
    function LangToggle() {
      const { setLang } = useLang();
      return (
        <button type="button" onClick={() => setLang("id")}>
          toggle-lang
        </button>
      );
    }
    const item: SupervisorUnlabelled = {
      ...BASE,
      display_status: "question_answered",
      staff_answer: { answer: "no", reason: "REASON-CONTENT-STRING" },
    };
    const { container } = render(
      <LangProvider initial="en">
        <LangToggle />
        <UnlabelledCard item={item} />
      </LangProvider>,
    );
    expect(container.querySelector("q")?.textContent).toBe("REASON-CONTENT-STRING");

    fireEvent.click(screen.getByRole("button", { name: "toggle-lang" }));

    expect(container.querySelector("q")?.textContent).toBe("REASON-CONTENT-STRING");
    expect(container.textContent).toContain("Belum berlabel");
  });

  it("360px safety: overflowWrap anywhere on the card", () => {
    const { container } = renderCard();
    const article = container.querySelector("article") as HTMLElement;
    expect(article.style.overflowWrap).toBe("anywhere");
  });
});
