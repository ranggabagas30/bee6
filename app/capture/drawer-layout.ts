import { useEffect, useState } from "react";

/**
 * Layout helpers for /capture next to the judge guide (R-19 PR-5; first written for the R-18 script drawer,
 * whose geometry QA validated). This file is imported by the page directly, so it must stay free of the guide
 * component and of the script data (the pilot bundle ships neither; the guide is mounted by the root layout
 * only when DEMO_MODE is on). `matchMedia` may not exist (jsdom, very old browsers), so every read falls back
 * to the narrow layout.
 *
 * LAYOUT:
 * - Under 900 px the guide is a fixed bottom sheet (app/ui/Sheet) collapsed to its handle; it reserves its own
 *   bottom space under the page (SHEET_RESERVE_PX + the safe-area inset in app/demo/JudgeGuide.tsx), so Start,
 *   End and Cancel are never covered. The page chrome is compacted (`isCompactChrome`) so banner + End + Cancel
 *   sit above the handle on a 360 x 640 screen.
 * - From 900 px up the guide is a fixed 360 px side panel (app/ui/SidePanel) on the right, collapsed to a pill
 *   top-right. The page column sits left of it in BOTH states (open and collapsed, no jump on toggle): the
 *   column is centred, so from 900 to about 1080 px its right edge would otherwise lie under the open panel.
 *
 * MANUAL GEOMETRY CHECK (jsdom has no layout, so this part is checked in a real browser, Chromium, with a
 * sandbox device: capture config carrying `demo_session`, DEMO_MODE=true):
 * 1. 360 x 640 and 360 x 740, Start tapped, guide collapsed and open: `getBoundingClientRect()` of the
 *    Listening banner, "End" and "Cancel session" each inside [0, innerHeight] with no scroll
 *    (`scrollY === 0`) while collapsed; `document.elementFromPoint` at the centre of End and of Cancel (after
 *    `.focus()`) returns the button itself.
 * 2. Widths 900, 960, 1024, 1100, 1280, 1440 x 800, panel collapsed and open: for every button, link and
 *    heading outside the panel (EN/ID switch, Start, the demo bar), `elementFromPoint` at its centre must
 *    return that element, never the panel or the pill; and the panel's rect must not overlap the page column's
 *    rect (`main`).
 */

export const PANEL_WIDTH_PX = 360;

const WIDE_QUERY = "(min-width: 900px)";

function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const sync = () => setMatches(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [query]);
  return matches;
}

export function useDrawerLayout(): { wide: boolean } {
  return { wide: useMedia(WIDE_QUERY) };
}

/**
 * Extra style for the page `<main>`. Only the side panel needs it (the 360 px column moves to the left of the
 * 360 px panel, open OR collapsed, so the toggle never moves the page); the bottom sheet needs nothing. No
 * guide means no change at all (the pilot).
 */
export function drawerInsetStyle(input: { present: boolean; wide: boolean }): React.CSSProperties {
  if (!input.present || !input.wide) return {};
  return { marginLeft: `max(0px, calc((100vw - ${PANEL_WIDTH_PX * 2}px) / 2))`, marginRight: "auto" };
}

/**
 * Compact page chrome (smaller top bar spacing, a one-row status banner) so that on a 360 x 640 phone the
 * banner, End and Cancel fit above the guide's collapsed handle without scrolling. Narrow screens with a
 * guide only: the pilot and wide screens keep the standard layout.
 */
export function isCompactChrome(input: { present: boolean; wide: boolean }): boolean {
  return input.present && !input.wide;
}
