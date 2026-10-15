import { DEMO_STATE_KEY } from "@/app/demo/demo-state-key";

/**
 * The inline script the root layout emits (DEMO_MODE only) while the page is still being parsed, before anything
 * below it paints. It marks `<html>` so globals.css can hold the room of the two fixed pieces of demo chrome that
 * mount only after hydration, instead of letting them push the page when they arrive (R-19 PR-5, CLS):
 *
 * - `b6-topbar-reserved`: the demo bar's slot (see DemoBarLoader), when this browser holds a demo state;
 * - `b6-panel-reserved`: the judge guide's collapsed pill at laptop widths (>= 900 px, see SidePanel and the
 *   `.b6-panel-reserved` rule), on the entry routes (`/`, `/sign-in`, `/pair`: the guide is always there) and
 *   wherever a demo state exists (the guide shows for the signed-in role, or on /capture once the bridge is up).
 *
 * Plain ES5 (it runs before any bundle), one `localStorage` key read (never parsed, never logged); storage being
 * blocked is not an error. Kept in its own module so a test can execute it for real against jsdom.
 */
export const FIRST_PAINT_SCRIPT =
  "try{var c=document.documentElement.classList,p=location.pathname.replace(/\\/+$/,\"\");" +
  'if(p===""||p==="/sign-in"||p==="/pair")c.add("b6-panel-reserved");' +
  `if(localStorage.getItem(${JSON.stringify(DEMO_STATE_KEY)})){c.add("b6-topbar-reserved");c.add("b6-panel-reserved")}}catch(e){}`;
