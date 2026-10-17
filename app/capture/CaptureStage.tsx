import css from "@/app/capture/capture.module.css";

const join = (...parts: Array<string | undefined>): string => parts.filter(Boolean).join(" ");

/**
 * The page-2 "stage": a soft glow, a ring and a 176 px orb (boards P2-04 idle, P2-05 listening, P2-08 amber,
 * P2-10 done). Pure decoration: the whole stage is `aria-hidden`, the h1 beside it carries the state, so a screen
 * reader hears nothing twice.
 *
 * TEMPORARY (R-25 T5): same API as the G0 `Stage` primitive (R-25 T1, docs/tasks/R-25-ui-fidelity.md section 9.2).
 * When that lands in `@/app/ui`, this file re-exports it and `capture.module.css` loses its stage block.
 */
export type StageTone = "idle" | "listening" | "amber" | "done";

const GLOW: Record<StageTone, string | undefined> = {
  idle: css.glowIdle,
  listening: css.glowListening,
  amber: css.glowAmber,
  done: css.glowListening,
};

const ORB: Record<StageTone, string | undefined> = {
  idle: css.orbIdle,
  listening: css.orbListening,
  amber: css.orbAmber,
  done: css.orbDone,
};

/** The two-bar Bee6 mark, drawn in `currentColor` (board svg.mark). */
function Mark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <rect x="8.15" y="6" width="31.7" height="16.1" rx="4.5" fill="currentColor" />
      <rect x="6.875" y="24.5" width="34.25" height="17.5" rx="4.8" fill="currentColor" />
    </svg>
  );
}

/** Seven voice bars (board `svg.wv`): the loud middle ones in the ink teal, the rest in the soft teal. */
function Wave({ animated }: { animated: boolean }) {
  const bars: ReadonlyArray<readonly [number, number, boolean]> = [
    [0, 20, false],
    [15, 44, false],
    [30, 28, false],
    [45, 64, true],
    [60, 69.2, true],
    [75, 40, false],
    [90, 20, false],
  ];
  return (
    <svg
      className={animated ? css.wave : undefined}
      width="92"
      height="66"
      viewBox="0 0 100 72"
      aria-hidden="true"
      focusable="false"
    >
      {bars.map(([x, h, loud]) => (
        <rect
          key={x}
          x={x}
          y={(72 - h) / 2}
          width="10"
          height={h}
          rx="2.8"
          fill={loud ? "var(--b6-teal-ink)" : "var(--b6-teal)"}
        />
      ))}
    </svg>
  );
}

export function CaptureStage({
  tone,
  label,
  animated = true,
}: {
  tone: StageTone;
  /** The orb's own word, e.g. "Start" (idle only). Decorative: the Start button is the real control. */
  label?: string;
  /** `false` freezes the stage (tests, screenshots). Motion also stops under prefers-reduced-motion. */
  animated?: boolean;
}) {
  return (
    <div className={css.stage} aria-hidden="true" data-tone={tone}>
      <div className={css.glow}>
        <div className={join(css.glowInner, GLOW[tone])} />
      </div>
      {tone === "listening" && animated ? <div className={css.ping} /> : null}
      <div className={css.shell} />
      <div className={join(css.orb, ORB[tone])}>
        {tone === "listening" ? (
          <Wave animated={animated} />
        ) : (
          <>
            <Mark size={58} />
            {label ? <span className={css.orbLabel}>{label}</span> : null}
          </>
        )}
      </div>
    </div>
  );
}
