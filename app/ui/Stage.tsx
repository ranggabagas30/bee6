import { cx } from "@/app/ui/cx";
import { LogoMark } from "@/app/ui/Logo";

export type StageTone = "idle" | "listening" | "amber" | "done";

export interface StageProps {
  tone: StageTone;
  /** Text inside the orb (the idle orb says "Start"). Decorative like the rest of the stage: the h1 carries the state. */
  label?: string;
  /** `false` renders the stage still (tests, screenshots). Motion is also off under prefers-reduced-motion. */
  animated?: boolean;
  className?: string;
}

// Seven bars as on the board; the two tall middle ones are the dark teal.
const WAVE: ReadonlyArray<{ x: number; y: number; h: number; hi?: boolean }> = [
  { x: 0, y: 26, h: 20 },
  { x: 15, y: 14, h: 44 },
  { x: 30, y: 22, h: 28 },
  { x: 45, y: 4, h: 64, hi: true },
  { x: 60, y: 1.4, h: 69.2, hi: true },
  { x: 75, y: 16, h: 40 },
  { x: 90, y: 26, h: 20 },
];

function OrbIcon({ tone }: { tone: StageTone }) {
  if (tone === "idle") return <LogoMark className="b6-orb__mark" />;
  if (tone === "listening") {
    return (
      <svg className="b6-orb__wave" viewBox="0 0 100 72" aria-hidden="true" focusable="false">
        {WAVE.map((b) => (
          <rect key={b.x} className={cx("b6-orb__bar", b.hi && "b6-orb__bar--hi")} x={b.x} y={b.y} width="10" height={b.h} rx="2.8" />
        ))}
      </svg>
    );
  }
  if (tone === "amber") {
    return (
      <svg className="b6-orb__spin b6-orb__mark" viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false">
        <circle className="b6-orb__spin-track" cx="24" cy="24" r="18" strokeWidth="4" />
        <path className="b6-orb__spin-arc" d="M24 6a18 18 0 0 1 18 18" strokeWidth="4" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg className="b6-orb__mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

/**
 * The 290px hero above a phone screen's h1: a soft glow, a shell and a 176px orb whose face shows the state
 * (idle mark, listening wave, amber spinner, done tick). Purely decorative, so the whole stage is `aria-hidden`:
 * the heading under it and the one live region of the page say what is happening.
 */
export function Stage({ tone, label, animated = true, className }: StageProps) {
  return (
    <div className={cx("b6-stage", `b6-stage--${tone}`, animated && "b6-stage--animated", className)} aria-hidden="true">
      <div className="b6-stage__glow">
        <div className="b6-stage__glow-in" />
      </div>
      {tone === "listening" ? (
        <div className="b6-orb-ring">
          <div className="b6-orb-ping" />
        </div>
      ) : null}
      <div className="b6-orb-shell" />
      <div className={cx("b6-orb", tone !== "idle" && `b6-orb--${tone}`)}>
        <OrbIcon tone={tone} />
        {label ? <span className="b6-orb__label">{label}</span> : null}
      </div>
    </div>
  );
}
