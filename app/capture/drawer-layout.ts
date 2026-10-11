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
 * - From 900 px up it is a fixed 360 px side panel. The page column sits left of it in BOTH states (open and
 *   collapsed), and the panel is pinned to the BOTTOM edge with `SIDE_PANEL_TOP_CLEARANCE_PX` of clear space
 *   above it. Why: the column is centred, so from 900 to about 1080 px its right edge lies under the 360 px
 *   panel; a collapsed panel pinned to the top covered the EN/ID switch (reproduced at 900, 960 and 1024 px),
 *   and an open full-height panel covered the right-hand "Switch to ..." button of the demo bar, which sits
 *   above `<main>` and can be about 110 px tall. Shifting the column always (no jump on toggle) clears the
 *   top bar; the clear band at the top keeps the panel off the demo bar.
 *
 * MANUAL GEOMETRY CHECK (jsdom has no layout, so this part is checked in a real browser, Chromium, with a
 * sandbox device: capture config carrying `demo_session`, and, for the demo bar, DEMO_MODE=true plus a
 * `bee6.demo` record in localStorage):
 * 1. 360 x 640 and 360 x 740, Start tapped, drawer open with a card shown: `getBoundingClientRect()` of the
 *    Listening banner, "End" and "Cancel session" each inside [0, innerHeight] with no scroll
 *    (`scrollY === 0`); `document.elementFromPoint` at the centre of End and of Cancel (after `.focus()`)
 *    returns the button itself; the drawer's bottom is <= innerHeight so its Next button is on screen.
 * 2. Widths 900, 960, 1024, 1100, 1280, 1440 x 800, drawer collapsed and open: for every button, link and
 *    heading outside the panel (EN/ID switch, Start, the demo bar's buttons), `elementFromPoint` at its
 *    centre must return that element, never the panel; and the panel's rect must not overlap the page
 *    column's rect (`main`) nor the demo bar's rect.
 */

export const HANDLE_HEIGHT_PX = 56;
export const PANEL_WIDTH_PX = 360;
/**
 * Free space kept above the side panel (from 900 px up), in px. The demo bar above `<main>` is about 106 px
 * tall at these widths (one line, one row of buttons, an empty status line) and about 150 px with a
 * two-line status message; 200 clears both with margin and still leaves the open panel 600 px of an
 * 800 px-tall screen.
 */
export const SIDE_PANEL_TOP_CLEARANCE_PX = 200;
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
 * 360 px panel, open OR collapsed, so the collapsed handle never covers the top bar); the in-flow narrow
 * drawer needs nothing. No drawer means no change at all (the pilot). `open` is accepted so callers can pass
 * the drawer state, but it deliberately does not matter.
 */
export function drawerInsetStyle(input: { present: boolean; wide: boolean; open?: boolean }): React.CSSProperties {
  if (!input.present || !input.wide) return {};
  return { marginLeft: `max(0px, calc((100vw - ${PANEL_WIDTH_PX * 2}px) / 2))`, marginRight: "auto" };
}

/**
 * Vertical box of the fixed side panel: pinned to the bottom edge, never to the top. Open it is the viewport
 * height minus `SIDE_PANEL_TOP_CLEARANCE_PX`; collapsed it is just its own handle.
 */
export function sidePanelBoxStyle(open: boolean): React.CSSProperties {
  return open ? { bottom: 0, height: `calc(100dvh - ${SIDE_PANEL_TOP_CLEARANCE_PX}px)` } : { bottom: 0 };
}

/**
 * Compact page chrome (smaller top bar spacing, a one-row status banner) so that on a 360 x 640 phone the
 * banner, End, Cancel and the open drawer fit without scrolling. Narrow screens with a drawer only: the pilot
 * and wide screens keep the standard layout.
 */
export function isCompactChrome(input: { present: boolean; wide: boolean }): boolean {
  return input.present && !input.wide;
}
