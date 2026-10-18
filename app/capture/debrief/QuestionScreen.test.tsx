// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QuestionScreen } from "@/app/capture/debrief/QuestionScreen";
import type { DebriefView } from "@/lib/debrief/flow";
import type { DebriefQuestionView } from "@/lib/debrief/contract";

/**
 * Question screen (R-07 Task 7.2, UX-03 section 4.2/5.8): one question at a
 * time, nothing preselected, no auto-advance, a required reason, a visible
 * counter that never truncates, and an upload status line driven only by the
 * uploader's last disposition.
 */

type QuestionView = Extract<DebriefView, { kind: "question" }>;

function q(overrides: Partial<DebriefQuestionView> = {}): DebriefQuestionView {
  return {
    question_id: "q1",
    kind: "gate",
    category: "ROUTINE_OPS",
    start_hm: "15:00",
    end_hm: "15:10",
    ...overrides,
  };
}

function baseView(overrides: Partial<QuestionView> = {}): QuestionView {
  return {
    kind: "question",
    list: [q(), q({ question_id: "q2" })],
    index: 0,
    choice: null,
    reason: "",
    save_error: false,
    answered: 0,
    skipped: 0,
    ...overrides,
  };
}

function Harness({
  initial,
  uploadNote = null,
  onLanjut = () => {},
  onLewati = () => {},
}: {
  initial: QuestionView;
  uploadNote?: "offline" | "refused" | null;
  onLanjut?: () => void;
  onLewati?: () => void;
}) {
  const [view, setView] = useState<QuestionView>(initial);
  return (
    <QuestionScreen
      view={view}
      lang="en"
      uploadNote={uploadNote}
      onChoose={(answer) => setView((v) => ({ ...v, choice: answer }))}
      onTypeReason={(reason) => setView((v) => ({ ...v, reason }))}
      onLanjut={onLanjut}
      onLewati={onLewati}
    />
  );
}

function button(name: string): HTMLButtonElement {
  return screen.getByRole("button", { name }) as HTMLButtonElement;
}

function textbox(): HTMLTextAreaElement {
  return screen.getByRole("textbox") as HTMLTextAreaElement;
}

afterEach(() => cleanup());

describe("QuestionScreen: choice", () => {
  it("nothing is preselected", () => {
    render(<Harness initial={baseView()} />);
    const ya = screen.getByRole("radio", { name: "Yes" });
    const tidak = screen.getByRole("radio", { name: "No" });
    expect(ya.getAttribute("aria-checked")).toBe("false");
    expect(tidak.getAttribute("aria-checked")).toBe("false");
  });

  it("tapping Ya selects it but does not advance (same question)", () => {
    render(<Harness initial={baseView()} />);
    fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
    expect(screen.getByRole("radio", { name: "Yes" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("Question 1 of 2")).toBeTruthy();
  });

  it("switching Ya to Tidak keeps the typed text and swaps the label", () => {
    render(<Harness initial={baseView({ choice: "yes", reason: "sudah dicek" })} />);
    expect(screen.getByText("Did it follow the SOP? If not, why?")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "No" }));
    expect(screen.getByText("Why not? Tell us briefly.")).toBeTruthy();
    expect(textbox().value).toBe("sudah dicek");
  });

  it("radios are role=radio with aria-checked, and arrow keys move selection", () => {
    render(<Harness initial={baseView()} />);
    const group = screen.getByRole("radiogroup");
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "No" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(group, { key: "ArrowLeft" });
    expect(screen.getByRole("radio", { name: "Yes" }).getAttribute("aria-checked")).toBe("true");
  });

  it("offers exactly Yes and No (no third answer: the route accepts yes or no only)", () => {
    render(<Harness initial={baseView()} />);
    expect(screen.getAllByRole("radio").map((r) => r.textContent?.trim())).toEqual(["Yes", "No"]);
    expect(screen.queryByRole("radio", { name: /Not sure/i })).toBeNull();
  });

  it("the chosen answer carries a visible check mark, not only a colour", () => {
    render(<Harness initial={baseView({ choice: "no" })} />);
    expect(screen.getByRole("radio", { name: "No" }).textContent).toContain("✓");
    expect(screen.getByRole("radio", { name: "Yes" }).textContent).not.toContain("✓");
  });
});

describe("QuestionScreen: reason and Lanjut", () => {
  it("Lanjut is disabled with no choice", () => {
    render(<Harness initial={baseView({ choice: null, reason: "" })} />);
    expect(button("Next question").disabled).toBe(true);
  });

  it("Lanjut is disabled with a choice and a whitespace-only reason", () => {
    render(<Harness initial={baseView({ choice: "yes", reason: "   " })} />);
    expect(button("Next question").disabled).toBe(true);
    expect(screen.getByText("Choose Yes or No, then give a reason.")).toBeTruthy();
  });

  it("Lanjut is enabled with a choice and a one-character reason", () => {
    render(<Harness initial={baseView({ choice: "yes", reason: "a" })} />);
    expect(button("Next question").disabled).toBe(false);
  });

  it("the textarea has no maxlength attribute, so a 600-char paste is kept in full", () => {
    render(<Harness initial={baseView({ choice: "yes", reason: "" })} />);
    const area = textbox();
    expect(area.hasAttribute("maxlength")).toBe(false);
    const pasted = "a".repeat(600);
    fireEvent.change(area, { target: { value: pasted } });
    expect(textbox().value.length).toBe(600);
  });

  it("over 500 trimmed characters shows the over-limit count and disables Lanjut; no storage write happens", () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    render(<Harness initial={baseView({ choice: "yes", reason: "a".repeat(600) })} />);
    // Shown twice by design: once as the counter, once as the disabled-reason helper.
    expect(screen.getAllByText("Too long. Remove 100 characters.")).toHaveLength(2);
    expect(button("Next question").disabled).toBe(true);
    expect(setItemSpy).not.toHaveBeenCalled();
    setItemSpy.mockRestore();
  });

  it("exactly 500 characters, including an emoji, is accepted and enables Lanjut", () => {
    const reason = "a".repeat(499) + "🎉"; // one emoji counts as one code point
    render(<Harness initial={baseView({ choice: "yes", reason })} />);
    // 500 is still inside the warning band (450-500 inclusive), 0 left.
    expect(screen.getByText("500/500 · 0 left")).toBeTruthy();
    expect(button("Next question").disabled).toBe(false);
  });

  it("the counter switches to the warning tone/text at 450", () => {
    render(<Harness initial={baseView({ choice: "yes", reason: "a".repeat(450) })} />);
    expect(screen.getByText("450/500 · 50 left")).toBeTruthy();
  });

  it("the counter stays plain below 450", () => {
    render(<Harness initial={baseView({ choice: "yes", reason: "a".repeat(10) })} />);
    expect(screen.getByText("10/500")).toBeTruthy();
  });
});

describe("QuestionScreen: save failure and upload status", () => {
  it("save_error shows the alert and keeps the typed choice/reason", () => {
    render(<Harness initial={baseView({ choice: "no", reason: "lupa", save_error: true })} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("The answer is not saved on this phone yet.");
    expect(screen.getByRole("radio", { name: "No" }).getAttribute("aria-checked")).toBe("true");
    expect(textbox().value).toBe("lupa");
  });

  it("shows the offline note for kept_offline", () => {
    render(<Harness initial={baseView()} uploadNote="offline" />);
    expect(screen.getByRole("status").textContent).toContain("Saved on the phone. Will be sent when online.");
  });

  it("shows the refused-but-retrying note for kept_retry", () => {
    render(<Harness initial={baseView()} uploadNote="refused" />);
    expect(screen.getByRole("status").textContent).toContain("Not sent yet. It will be retried automatically.");
  });

  it("shows nothing when there is no upload note", () => {
    render(<Harness initial={baseView()} uploadNote={null} />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("QuestionScreen: Lewati and the locked helper", () => {
  it("Lewati is always enabled, even with no choice", () => {
    render(<Harness initial={baseView()} />);
    expect(button("Skip").disabled).toBe(false);
  });

  it("Lewati calls onLewati with no onLanjut side effect", () => {
    const onLewati = vi.fn();
    const onLanjut = vi.fn();
    render(<Harness initial={baseView({ choice: "yes", reason: "sudah" })} onLewati={onLewati} onLanjut={onLanjut} />);
    fireEvent.click(button("Skip"));
    expect(onLewati).toHaveBeenCalledTimes(1);
    expect(onLanjut).not.toHaveBeenCalled();
  });

  it("shows the locked helper once, only on the first question", () => {
    render(<Harness initial={baseView({ index: 0 })} />);
    expect(screen.getByText("An answer sent with Next cannot be changed.")).toBeTruthy();
  });

  it("does not show the locked helper on the second question", () => {
    render(<Harness initial={baseView({ index: 1, answered: 1 })} />);
    expect(screen.queryByText("An answer sent with Next cannot be changed.")).toBeNull();
  });
});

describe("QuestionScreen: R-18 Earlier day chip", () => {
  it("shows the chip with the day when the question carries a business_date, and none otherwise", () => {
    render(<Harness initial={baseView({ list: [q({ business_date: "2026-10-12" }), q({ question_id: "q2" })] })} />);
    expect(screen.getByText("Earlier day · Mon 12 Oct")).toBeTruthy();
  });

  it("no chip for a same-day question (every pilot question)", () => {
    render(<Harness initial={baseView()} />);
    expect(screen.queryByText(/Earlier day/)).toBeNull();
  });

  it("no chip when the question's day is the debrief's day or LATER, whatever the server sent", () => {
    for (const day of ["2026-10-12", "2026-10-13"]) {
      cleanup();
      render(
        <QuestionScreen
          view={baseView({ list: [q({ business_date: day })] })}
          debriefDate="2026-10-12"
          lang="en"
          uploadNote={null}
          onChoose={() => {}}
          onTypeReason={() => {}}
          onLanjut={() => {}}
          onLewati={() => {}}
        />,
      );
      expect(screen.queryByText(/Earlier day/)).toBeNull();
    }
  });

  it("the chip shows only for a day strictly before the debrief's day", () => {
    render(
      <QuestionScreen
        view={baseView({ list: [q({ business_date: "2026-10-11" })] })}
        debriefDate="2026-10-12"
        lang="en"
        uploadNote={null}
        onChoose={() => {}}
        onTypeReason={() => {}}
        onLanjut={() => {}}
        onLewati={() => {}}
      />,
    );
    expect(screen.getByText("Earlier day · Sun 11 Oct")).toBeTruthy();
  });

  it("Bahasa chip", () => {
    render(
      <QuestionScreen
        view={baseView({ list: [q({ business_date: "2026-10-12" })] })}
        lang="id"
        uploadNote={null}
        onChoose={() => {}}
        onTypeReason={() => {}}
        onLanjut={() => {}}
        onLewati={() => {}}
      />,
    );
    expect(screen.getByText("Hari sebelumnya · Sen 12 Okt")).toBeTruthy();
  });
});

describe("QuestionScreen: R-25 T7 page-2 layout (boards P2-09 / L2-08)", () => {
  const props = { lang: "en" as const, uploadNote: null, onChoose: () => {}, onTypeReason: () => {}, onLanjut: () => {}, onLewati: () => {} };

  it("header: the question counter and the minutes-left chip; no live region for the chip", () => {
    render(<QuestionScreen view={baseView({ index: 1, answered: 1 })} {...props} minutesLeft={47} />);
    expect(screen.getByText("Question 2 of 2")).toBeTruthy();
    expect(screen.getByText("47 min left")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("no chip without minutesLeft", () => {
    render(<QuestionScreen view={baseView()} {...props} />);
    expect(screen.queryByText(/min left/)).toBeNull();
  });

  it("progress: one list item per question over the whole debrief, the current one is aria-current, earlier ones are done", () => {
    // Two answered and one skipped earlier (counters survive a reload), two questions still to come in this list.
    render(<QuestionScreen view={baseView({ list: [q(), q({ question_id: "q2" })], index: 0, answered: 2, skipped: 1 })} {...props} minutesLeft={9} />);
    expect(screen.getByText("Question 4 of 5")).toBeTruthy();
    const bars = within(screen.getByRole("list", { name: "Progress" })).getAllByRole("listitem");
    expect(bars).toHaveLength(5);
    expect(bars.map((b) => b.getAttribute("aria-current"))).toEqual([null, null, null, "step", null]);
  });

  it("tech-lead addendum case: answered 3, skipped 0, first of a 2-question list reads QUESTION 4 OF 5 with five bars", () => {
    render(<QuestionScreen view={baseView({ list: [q(), q({ question_id: "q2" })], index: 0, answered: 3, skipped: 0 })} {...props} />);
    expect(screen.getByText("Question 4 of 5")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Progress" })).getAllByRole("listitem")).toHaveLength(5);
  });

  it("inside one list the counters already include the questions acted on, so the position is not counted twice", () => {
    // 5 questions in one list, two answered in this list (counters 2, index 2): the third is on screen.
    const five = ["a", "b", "c", "d", "e"].map((id) => q({ question_id: id }));
    render(<QuestionScreen view={baseView({ list: five, index: 2, answered: 2, skipped: 0 })} {...props} />);
    expect(screen.getByText("Question 3 of 5")).toBeTruthy();
  });

  it("a refresh that appends to the list grows the total, never shrinks the position", () => {
    render(<QuestionScreen view={baseView({ list: [q(), q({ question_id: "q2" }), q({ question_id: "q3" })], index: 1, answered: 1 })} {...props} />);
    expect(screen.getByText("Question 2 of 3")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Progress" })).getAllByRole("listitem")).toHaveLength(3);
  });

  it("card: the category code chip (spoken as the category name), the time, the heading and the fixed explanation", () => {
    render(<QuestionScreen view={baseView({ list: [q({ category: "CUSTOMER_SERVICE", start_hm: "10:40" })] })} {...props} />);
    expect(screen.getByText("CST")).toBeTruthy();
    expect(screen.getByText("Customer service")).toBeTruthy(); // visually hidden, read by a screen reader
    expect(screen.getByText("Today · 10:40")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Around 10:40 there was customer service. Is that right?");
    expect(screen.getByText("Bee6 heard a customer being served. It needs your answer to be sure.")).toBeTruthy();
  });

  it("an unlabelled block question has no category chip and the block explanation", () => {
    render(<QuestionScreen view={baseView({ list: [q({ kind: "unlabelled_unit", category: null })] })} {...props} />);
    expect(screen.queryByText("CST")).toBeNull();
    expect(screen.getByText("Bee6 heard work here but could not tell what. It needs your answer to be sure.")).toBeTruthy();
  });

  it("an earlier-day question swaps 'Today' for the Earlier day chip and keeps the time", () => {
    render(<QuestionScreen view={baseView({ list: [q({ business_date: "2026-10-12", start_hm: "10:40" })] })} debriefDate="2026-10-13" {...props} />);
    expect(screen.getByText("Earlier day · Mon 12 Oct")).toBeTruthy();
    expect(screen.queryByText(/^Today/)).toBeNull();
    expect(screen.getByText("10:40")).toBeTruthy();
  });

  it("reason: always on screen with a visible label and the board placeholder; the label follows the choice", () => {
    const { rerender } = render(<QuestionScreen view={baseView()} {...props} />);
    const area = screen.getByLabelText(/Your reason\. Required, no names\./) as HTMLTextAreaElement;
    expect(area.placeholder).toBe("Why? Add a short reason (required)");
    expect(area.getAttribute("aria-required")).toBe("true");
    rerender(<QuestionScreen view={baseView({ choice: "yes" })} {...props} />);
    expect(screen.getByLabelText(/Did it follow the SOP\? If not, why\?/)).toBeTruthy();
  });

  it("the primary action is 'Next question'; Skip stays as a quiet button under it", () => {
    render(<QuestionScreen view={baseView({ choice: "yes", reason: "ok" })} {...props} />);
    const buttons = screen.getAllByRole("button").map((b) => b.textContent?.trim());
    expect(buttons.indexOf("Next question")).toBeLessThan(buttons.indexOf("Skip"));
    expect(button("Next question").className).toContain("b6-btn--lg");
  });

  it("notes: the debrief does not end on an answer, then the first question's cannot-be-changed line", () => {
    render(<QuestionScreen view={baseView()} {...props} />);
    const a = screen.getByText("Answering does not end the debrief. It ends when every question is answered or the 60 minutes are over.");
    const b = screen.getByText("An answer sent with Next cannot be changed.");
    expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the disabled Next button is described by its help line", () => {
    render(<QuestionScreen view={baseView()} {...props} />);
    const next = button("Next question");
    const helpId = next.getAttribute("aria-describedby");
    expect(helpId).toBeTruthy();
    expect(document.getElementById(helpId as string)?.textContent).toBe("Choose Yes or No, then give a reason.");
  });

  it("Bahasa: the same screen reads in Indonesian", () => {
    render(<QuestionScreen view={baseView({ list: [q({ category: "PHONE_CALL" })] })} {...props} lang="id" minutesLeft={5} />);
    expect(screen.getByText("sisa 5 mnt")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pertanyaan berikutnya" })).toBeTruthy();
    expect(screen.getByText("Bee6 mendengar yang terdengar seperti telepon. Bee6 butuh jawabanmu untuk memastikan.")).toBeTruthy();
  });
});

describe("QuestionScreen: quoted lines (demo-feedback-2 item 10, sandbox only)", () => {
  const noop = () => {};
  function renderScreen(question: DebriefQuestionView, lang: "en" | "id" = "en") {
    return render(
      <QuestionScreen
        view={baseView({ list: [question] })}
        lang={lang}
        uploadNote={null}
        onChoose={noop}
        onTypeReason={noop}
        onLanjut={noop}
        onLewati={noop}
      />,
    );
  }
  const WHY = "Bee6 heard routine work in the shop. It needs your answer to be sure.";

  it("shows the lead-in and each line as a quoted text node, replacing the generic why sentence", () => {
    renderScreen(q({ lines: ["Pelanggan tanya roti tawar habis.", "Kami bilang besok pagi ada lagi."] }));
    expect(screen.getByText("Bee6 heard:")).toBeTruthy();
    expect(screen.getByText("“Pelanggan tanya roti tawar habis.”")).toBeTruthy();
    expect(screen.getByText("“Kami bilang besok pagi ada lagi.”")).toBeTruthy();
    expect(screen.queryByText(WHY)).toBeNull();
  });

  it("without lines the generic why sentence stays and no lead-in shows (the pilot screen)", () => {
    renderScreen(q());
    expect(screen.getByText(WHY)).toBeTruthy();
    expect(screen.queryByText("Bee6 heard:")).toBeNull();
  });

  it("Bahasa lead-in", () => {
    renderScreen(q({ lines: ["Pelanggan tanya roti."] }), "id");
    expect(screen.getByText("Bee6 mendengar:")).toBeTruthy();
    expect(screen.getByText("“Pelanggan tanya roti.”")).toBeTruthy();
  });

  it("renders markup and braces inertly: no element is created and no placeholder is interpolated", () => {
    const { container } = renderScreen(q({ lines: ["<b>x</b> <img src=x onerror=alert(1)>", "{hm} {step} {code}"] }));
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("“<b>x</b> <img src=x onerror=alert(1)>”")).toBeTruthy();
    expect(screen.getByText("“{hm} {step} {code}”")).toBeTruthy();
  });

  it("keeps the chip, the time and the template heading", () => {
    renderScreen(q({ lines: ["Pelanggan tanya roti."] }));
    expect(screen.getByText("Today · 15:00")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Around 15:00 there was routine work. Is that right?");
  });

  it("the radiogroup aria-label stays the template only: the quote is read once, in the card", () => {
    renderScreen(q({ lines: ["Pelanggan tanya roti."] }));
    const group = screen.getByRole("radiogroup");
    expect(group.getAttribute("aria-label")).toBe("Around 15:00 there was routine work. Is that right?");
    expect(group.getAttribute("aria-label")).not.toContain("Pelanggan");
  });

  it("an unlabelled_unit without lines keeps its own why sentence", () => {
    renderScreen(q({ kind: "unlabelled_unit", category: null }));
    expect(screen.getByText("Bee6 heard work here but could not tell what. It needs your answer to be sure.")).toBeTruthy();
  });
});

describe("QuestionScreen: DebriefAgent question_text (sandbox only)", () => {
  const noop = () => {};
  const TEXT = "Around 15:00, was the oven checked before opening?";
  function renderScreen(question: DebriefQuestionView, lang: "en" | "id" = "en") {
    return render(
      <QuestionScreen
        view={baseView({ list: [question] })}
        lang={lang}
        uploadNote={null}
        onChoose={noop}
        onTypeReason={noop}
        onLanjut={noop}
        onLewati={noop}
      />,
    );
  }

  it("the heading is the agent's wording, in place of the template", () => {
    renderScreen(q({ question_text: TEXT }));
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(TEXT);
    expect(screen.queryByText("Around 15:00 there was routine work. Is that right?")).toBeNull();
  });

  it("the quoted 'Bee6 heard:' lines stay under the agent's heading, and the chip and time stay", () => {
    renderScreen(q({ question_text: TEXT, lines: ["Pelanggan tanya roti tawar habis."] }));
    expect(screen.getByText("Bee6 heard:")).toBeTruthy();
    expect(screen.getByText("“Pelanggan tanya roti tawar habis.”")).toBeTruthy();
    expect(screen.getByText("Today · 15:00")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(TEXT);
  });

  it("the radiogroup aria-label stays the template (the quote and the wording are read once, in the card)", () => {
    renderScreen(q({ question_text: TEXT }));
    expect(screen.getByRole("radiogroup").getAttribute("aria-label")).toBe("Around 15:00 there was routine work. Is that right?");
  });

  it("is a plain text node: markup, entities and braces render inertly and nothing is interpolated", () => {
    const hostile = "<b>x</b> <img src=x onerror=alert(1)> &amp; {hm} {step} {code} ${1+1}";
    const { container } = renderScreen(q({ question_text: hostile }));
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading.textContent).toBe(hostile);
    expect(heading.children).toHaveLength(1); // the one line span, no parsed markup inside it
    expect(heading.querySelector("span")!.children).toHaveLength(0);
  });

  it("a Bahasa UI shows the same wording (EN until Rangga decides, D10) with the rest of the screen in Bahasa", () => {
    renderScreen(q({ question_text: TEXT }), "id");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(TEXT);
    expect(screen.getByRole("radio", { name: "Ya" })).toBeTruthy();
  });

  it("without question_text the template heading is unchanged (the pilot screen)", () => {
    renderScreen(q());
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Around 15:00 there was routine work. Is that right?");
  });
});
