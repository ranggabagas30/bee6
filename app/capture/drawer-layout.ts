import { useEffect, useState } from "react";
import { HANDLE_HEIGHT_PX, PANEL_WIDTH_PX, SHEET_MAX_VH } from "@/app/capture/ScriptDrawer";

/**
 * Responsive helpers for the R-18 script drawer. `matchMedia` may not exist (jsdom, very old browsers), so
 * every read falls back to the safe phone layout with motion on.
 */

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
 * Extra style for the page `<main>` so the drawer never covers it: a bottom sheet reserves its own height as
 * bottom padding (so the End and Cancel buttons can always be scrolled into view above it); the side panel
 * moves the 360 px column to the left of the 360 px panel. No drawer means no change at all (the pilot).
 */
export function drawerInsetStyle(input: { present: boolean; wide: boolean; open: boolean }): React.CSSProperties {
  if (!input.present) return {};
  if (input.wide) {
    return input.open
      ? { marginLeft: `max(0px, calc((100vw - ${PANEL_WIDTH_PX * 2}px) / 2))`, marginRight: "auto" }
      : {};
  }
  return { paddingBottom: input.open ? `calc(${SHEET_MAX_VH}vh + 24px)` : `${HANDLE_HEIGHT_PX + 24}px` };
}
