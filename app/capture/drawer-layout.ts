import { useEffect, useState } from "react";

/**
 * Layout helpers and constants for the R-18 script drawer. This file is imported by the page directly, so it
 * must stay free of the drawer component and of the script data (the pilot bundle ships neither; the page
 * loads `ScriptDrawer` lazily, only for a sandbox device). `matchMedia` may not exist (jsdom, very old
 * browsers), so every read falls back to the narrow layout with motion on.
 *
 * LAYOUT (decided after QA reproduced a sheet covering End and Cancel at 360 x 640 and 360 x 740):
 * - Under 900 px the drawer is IN THE PAGE FLOW, after the status banner and the End / Cancel buttons. Nothing
 *   is fixed, so it cannot cover anything, no padding has to match its height, and a focused control is never
 *   obscured (WCAG 2.4.11). Open it is at most `SHEET_MAX_DVH` of the screen height, with its card area
 *   scrolling inside it and Back / Next pinned below that area. The page chrome above it is compacted
 *   (`isCompactChrome`) so banner + End + Cancel + the open drawer fit one 640 px screen.
 * - From 900 px up it is a fixed 360 px side panel and the page column moves left of it.
 *
 * MANUAL GEOMETRY CHECK (jsdom has no layout, so this part is checked in a real browser): in Chromium at
 * 360 x 640 and 360 x 740, with a sandbox device (capture config carrying `demo_session`), tap Start and with
 * the drawer open and a card shown measure `getBoundingClientRect()` of the Listening banner, "End" and
 * "Cancel session": each must lie inside [0, innerHeight] with no scroll (`scrollY === 0`), and
 * `document.elementFromPoint` at the centre of End and of Cancel (after `.focus()`) must return the button
 * itself. The drawer's own bottom must also be <= innerHeight so its Next button is on screen.
 */

export const HANDLE_HEIGHT_PX = 56;
export const PANEL_WIDTH_PX = 360;
/** Open height cap of the in-flow drawer on narrow screens, in dynamic viewport height units. */
export const SHEET_MAX_DVH = 45;

export type DrawerState = "before" | "running" | "ended";

const WIDE_QUERY = "(min-width: 900px)";
const MOTION_QUERY = "(prefers-reduced-motion: reduce)";

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

export function useDrawerLayout(): { wide: boolean; reducedMotion: boolean } {
  return { wide: useMedia(WIDE_QUERY), reducedMotion: useMedia(MOTION_QUERY) };
}

/**
 * Extra style for the page `<main>`. Only the side panel needs it (the 360 px column moves to the left of the
 * 360 px panel); the in-flow narrow drawer needs nothing. No drawer means no change at all (the pilot).
 */
export function drawerInsetStyle(input: { present: boolean; wide: boolean; open: boolean }): React.CSSProperties {
  if (!input.present || !input.wide || !input.open) return {};
  return { marginLeft: `max(0px, calc((100vw - ${PANEL_WIDTH_PX * 2}px) / 2))`, marginRight: "auto" };
}

/**
 * Compact page chrome (smaller top bar spacing, a one-row status banner) so that on a 360 x 640 phone the
 * banner, End, Cancel and the open drawer fit without scrolling. Narrow screens with a drawer only: the pilot
 * and wide screens keep the standard layout.
 */
export function isCompactChrome(input: { present: boolean; wide: boolean }): boolean {
  return input.present && !input.wide;
}
