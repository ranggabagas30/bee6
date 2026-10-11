// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

  it("at 360px both radios sit in one row with flex: 1 each", () => {
    render(<Harness initial={baseView()} />);
    const group = screen.getByRole("radiogroup") as HTMLElement;
    expect(group.style.display).toBe("flex");
    for (const radio of screen.getAllByRole("radio")) {
      expect((radio as HTMLElement).style.flex).toBe("1 1 0%");
    }
  });
});

describe("QuestionScreen: reason and Lanjut", () => {
  it("Lanjut is disabled with no choice", () => {
    render(<Harness initial={baseView({ choice: null, reason: "" })} />);
    expect(button("Next").disabled).toBe(true);
  });

  it("Lanjut is disabled with a choice and a whitespace-only reason", () => {
    render(<Harness initial={baseView({ choice: "yes", reason: "   " })} />);
    expect(button("Next").disabled).toBe(true);
    expect(screen.getByText("Choose Yes or No, then give a reason.")).toBeTruthy();
  });

  it("Lanjut is enabled with a choice and a one-character reason", () => {
    render(<Harness initial={baseView({ choice: "yes", reason: "a" })} />);
    expect(button("Next").disabled).toBe(false);
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
    expect(button("Next").disabled).toBe(true);
    expect(setItemSpy).not.toHaveBeenCalled();
    setItemSpy.mockRestore();
  });

  it("exactly 500 characters, including an emoji, is accepted and enables Lanjut", () => {
    const reason = "a".repeat(499) + "🎉"; // one emoji counts as one code point
    render(<Harness initial={baseView({ choice: "yes", reason })} />);
    // 500 is still inside the warning band (450-500 inclusive), 0 left.
    expect(screen.getByText("500/500 · 0 left")).toBeTruthy();
    expect(button("Next").disabled).toBe(false);
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
    render(<Harness initial={baseView({ index: 1 })} />);
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

describe("QuestionScreen: R-18 Check for new questions", () => {
  const props = { lang: "en" as const, uploadNote: null, onChoose: () => {}, onTypeReason: () => {}, onLanjut: () => {}, onLewati: () => {} };
  it("absent unless the caller passes onCheck (the pilot never does)", () => {
    render(<QuestionScreen view={baseView()} {...props} />);
    expect(screen.queryByRole("button", { name: /Check for new questions/ })).toBeNull();
  });
  it("a 48 px button that calls onCheck; disabled and relabelled while checking", () => {
    const onCheck = vi.fn();
    const { rerender } = render(<QuestionScreen view={baseView()} {...props} onCheck={onCheck} checking={false} />);
    const btn = screen.getByRole("button", { name: "Check for new questions" }) as HTMLButtonElement;
    expect(btn.style.minHeight).toBe("48px");
    fireEvent.click(btn);
    expect(onCheck).toHaveBeenCalledTimes(1);
    rerender(<QuestionScreen view={baseView()} {...props} onCheck={onCheck} checking />);
    expect((screen.getByRole("button", { name: "Checking…" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

