import type { CSSProperties } from "react";
import { useLang } from "@/lib/i18n/context";
import { t } from "@/lib/i18n/dict";
import { STATUS_KEY } from "@/lib/day/view-model";
import type { SupervisorUnlabelled } from "@/lib/day/contract";

/**
 * One unlabelled-moment row (R-06 Task 12.4). Supervisor only — the owner
 * response never carries `unlabelled` rows at all, so this component is
 * never reached on the owner path. There is no `summary`, `category`,
 * `confidence_pct`, `evidence` or `runner_up` to show (the label call never
 * produced a thread at all: the unit's lines live only in `segments`, TTL 48
 * h, and are not read here) and no supervisor action (there is no thread to
 * confirm/override/reject) — only the time, the status, a help line and,
 * when the staff answered, the same answer rendering `ThreadCard` uses.
 */

const CARD_STYLE: CSSProperties = {
  border: "1px solid #d1d5db",
  borderRadius: 8,
  padding: 12,
  marginBottom: 12,
  overflowWrap: "anywhere",
};

const LINE_STYLE: CSSProperties = { margin: "0 0 4px 0" };

const BADGE_STYLE: CSSProperties = {
  display: "inline-block",
  border: "1px solid #374151",
  borderRadius: 999,
  padding: "2px 8px",
  fontSize: 14,
};

export function UnlabelledCard({ item }: { item: SupervisorUnlabelled }) {
  const { lang } = useLang();

  return (
    <article style={CARD_STYLE}>
      <p style={LINE_STYLE}>
        {t(lang, "C-day-time", { start: item.start_hm, end: item.end_hm })}
        {" · "}
        {t(lang, "C-day-unlabelled")}
      </p>
      <p style={LINE_STYLE}>
        <span style={BADGE_STYLE}>{t(lang, STATUS_KEY[item.display_status])}</span>
      </p>
      <p style={{ overflowWrap: "anywhere", margin: 0 }}>{t(lang, "C-day-unlabelled-help")}</p>

      {item.staff_answer && (
        <p style={{ overflowWrap: "anywhere", margin: "8px 0 0 0" }}>
          {t(lang, item.staff_answer.answer === "yes" ? "C-day-ans-yes" : "C-day-ans-no")}
          {item.staff_answer.reason !== null && (
            <>
              {" "}
              <q>{item.staff_answer.reason}</q>
            </>
          )}
        </p>
      )}
    </article>
  );
}
