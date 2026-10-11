"use client";

import { useEffect, useId, useRef } from "react";
import { canCommit, type DebriefView } from "@/lib/debrief/flow";
import { reasonLength } from "@/lib/debrief/reason";
import { REASON_MAX_CHARS } from "@/lib/debrief/constants";
import { questionLines, questionText } from "@/lib/i18n/category-labels";
import { t } from "@/lib/i18n/dict";
import { dayLabel } from "@/lib/i18n/format";
import type { Lang } from "@/lib/i18n/lang";
import { CheckNewButton } from "@/app/capture/debrief/CheckNewButton";

/**
 * One debrief question at a time (R-07 Task 7.2, UX-03 section 4.2/5.8).
 * Purely presentational and controlled: the caller (`DebriefFlow`) owns the
 * reducer state and the Lanjut/Lewati side effects (the phone cache write,
 * the POST, the gate). Nothing here ever reads a server-supplied thread
 * line, a name or a role — only `questionText()`'s enum-mapped template.
 */

export type QuestionView = Extract<DebriefView, { kind: "question" }>;

export interface QuestionScreenProps {
  view: QuestionView;
  lang: Lang;
  /** The uploader's last disposition for THIS screen's own flush, or null to show nothing. */
  uploadNote: "offline" | "refused" | null;
  onChoose: (answer: "yes" | "no") => void;
  onTypeReason: (reason: string) => void;
  onLanjut: () => void;
  onLewati: () => void;
  /** R-18, sandbox only: omitted on the pilot, so no "Check for new questions" button renders there. */
  onCheck?: () => void;
  checking?: boolean;
}

const RADIOGROUP_STYLE: React.CSSProperties = {
  display: "flex",
  gap: 8,
  marginTop: 12,
};

const RADIO_BASE_STYLE: React.CSSProperties = {
  flex: "1 1 0%",
  minHeight: 48,
  fontSize: 16,
  fontWeight: 700,
  borderWidth: 2,
  borderStyle: "solid",
  borderColor: "#444",
  borderRadius: 8,
  background: "#fff",
};

const RADIO_SELECTED_STYLE: React.CSSProperties = {
  background: "#1a4d2e",
  color: "#fff",
  borderColor: "#1a4d2e",
};

export function QuestionScreen({ view, lang, uploadNote, onChoose, onTypeReason, onLanjut, onLewati, onCheck, checking = false }: QuestionScreenProps) {
  const question = view.list[view.index];
  const headingRef = useRef<HTMLDivElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const textareaId = useId();

  // A fresh question (new index) moves focus to the heading (UX-03 section
  // 4.2: "each new question moves focus to its heading").
  useEffect(() => {
    headingRef.current?.focus();
  }, [view.index]);

  // A refused Lanjut moves focus to the first error (UX-03 section 4.2).
  useEffect(() => {
    if (view.save_error) alertRef.current?.focus();
  }, [view.save_error]);

  if (!question) return null;

  const qText = questionText(lang, question);
  const qLines = questionLines(lang, question);
  const n = reasonLength(view.reason);
  const over = n > REASON_MAX_CHARS ? n - REASON_MAX_CHARS : 0;
  const disabled = !canCommit(view);

  function handleGroupKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    onChoose(e.key === "ArrowLeft" ? "yes" : "no");
  }

  function counterNode() {
    if (over > 0) {
      return t(lang, over === 1 ? "C-d-over-one" : "C-d-over", { N: over });
    }
    if (n >= 450) return t(lang, "C-d-count-warn", { N: n, M: REASON_MAX_CHARS - n });
    return t(lang, "C-d-count", { N: n });
  }

  function disabledHelp(): string | null {
    if (!disabled) return null;
    if (over > 0) return t(lang, over === 1 ? "C-d-over-one" : "C-d-over", { N: over });
    return t(lang, "C-d-help-dis");
  }

  const reasonLabelLines: [string, string] =
    view.choice === "yes"
      ? [t(lang, "C-d-r-yes"), t(lang, "C-d-r-yes-2")]
      : view.choice === "no"
        ? [t(lang, "C-d-r-no"), t(lang, "C-d-r-no-2")]
        : ["", ""];

  return (
    <section>
      <div ref={headingRef} tabIndex={-1} style={{ outline: "none" }}>
        <p style={{ fontSize: 14, margin: 0, color: "#555" }}>
          {t(lang, "C-d-prog", { N: view.index + 1, M: view.list.length })}
        </p>
        {question.business_date ? (
          <p
            style={{
              display: "inline-block",
              margin: "6px 0 0",
              padding: "2px 8px",
              border: "1px solid #7A4F00",
              borderRadius: 12,
              fontSize: 13,
              color: "#7A4F00",
            }}
          >
            {t(lang, "C-script-earlier-day", { date: dayLabel(question.business_date, lang) })}
          </p>
        ) : null}
        <h2 style={{ fontSize: 18, margin: "4px 0 0" }}>
          {qLines.map((line, i) => (
            <span key={i} style={{ display: "block" }}>
              {line}
            </span>
          ))}
        </h2>
      </div>

      <div
        role="radiogroup"
        aria-label={qText}
        style={RADIOGROUP_STYLE}
        onKeyDown={handleGroupKeyDown}
      >
        <button
          type="button"
          role="radio"
          aria-checked={view.choice === "yes"}
          style={view.choice === "yes" ? { ...RADIO_BASE_STYLE, ...RADIO_SELECTED_STYLE } : RADIO_BASE_STYLE}
          onClick={() => onChoose("yes")}
        >
          {view.choice === "yes" ? <span aria-hidden="true">✓ </span> : null}
          {t(lang, "C-d-yes")}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={view.choice === "no"}
          style={view.choice === "no" ? { ...RADIO_BASE_STYLE, ...RADIO_SELECTED_STYLE } : RADIO_BASE_STYLE}
          onClick={() => onChoose("no")}
        >
          {view.choice === "no" ? <span aria-hidden="true">✓ </span> : null}
          {t(lang, "C-d-no")}
        </button>
      </div>

      {view.choice !== null ? (
        <div style={{ marginTop: 12 }}>
          <label htmlFor={textareaId} style={{ display: "block", fontSize: 14 }}>
            <span>{reasonLabelLines[0]}</span> <span>{reasonLabelLines[1]}</span>
          </label>
          <textarea
            id={textareaId}
            rows={4}
            autoComplete="off"
            style={{ width: "100%", fontSize: 16, boxSizing: "border-box", marginTop: 4 }}
            value={view.reason}
            onChange={(e) => onTypeReason(e.target.value)}
          />
          <p style={{ textAlign: "right", margin: "2px 0 0", fontSize: 13, color: over > 0 || n >= 450 ? "#7A4F00" : "#555" }}>
            {counterNode()}
          </p>
        </div>
      ) : null}

      {view.save_error ? (
        <div ref={alertRef} role="alert" tabIndex={-1} style={{ marginTop: 12, color: "#b00020" }}>
          <p style={{ margin: 0, fontWeight: 600 }}>{t(lang, "C-d-save-fail")}</p>
          <p style={{ margin: "2px 0 0" }}>{t(lang, "C-d-save-fail-2")}</p>
          <p style={{ margin: "2px 0 0" }}>{t(lang, "C-d-save-fail-3")}</p>
        </div>
      ) : null}

      {uploadNote ? (
        <div role="status" aria-live="polite" style={{ marginTop: 12, fontSize: 14, color: "#7A4F00" }}>
          {t(lang, uploadNote === "offline" ? "C-d-offline" : "C-d-refused")}
        </div>
      ) : null}

      <div style={{ marginTop: 16, display: "flex", justifyContent: "space-between", gap: 8 }}>
        <button type="button" style={{ minHeight: 48, padding: "0 16px" }} onClick={onLewati}>
          {t(lang, "C-b-lewati")}
        </button>
        <button
          type="button"
          style={{ minHeight: 48, padding: "0 16px", fontWeight: 700 }}
          onClick={onLanjut}
          disabled={disabled}
        >
          {t(lang, "C-b-lanjut")}
        </button>
      </div>
      {onCheck ? <CheckNewButton lang={lang} onCheck={onCheck} checking={checking} /> : null}
      {disabledHelp() ? <p style={{ fontSize: 13, color: "#555" }}>{disabledHelp()}</p> : null}
      {view.index === 0 ? <p style={{ fontSize: 13, color: "#555" }}>{t(lang, "C-d-locked")}</p> : null}
    </section>
  );
}
