import { DEMO_STATE_KEY } from "@/app/demo/demo-state-key";

/**
 * The inline script the root layout emits (DEMO_MODE only) while the page is still being parsed, before anything
 * below it paints. It marks `<html>` so globals.css can hold the room of the one piece of demo chrome that mounts
 * only after hydration, instead of letting it push the page when it arrives (R-19 PR-5, CLS):
 *
 * - `b6-panel-reserved`: the judge guide's collapsed pill at laptop widths (>= 900 px, see SidePanel and the
 *   `.b6-panel-reserved` rule), on the entry routes (`/`, `/sign-in`, `/pair`: the guide is always there), on
 *   `/capture` (an unpaired browser is sent to `/pair`, a paired sandbox phone gets the card once the bridge is
 *   up: either way the pill follows) and wherever a LIVE demo state exists (the guide shows for the signed-in
 *   role; an ended one signs the judge out, so no guide on a web route).
 *
 * R-25 (ruling R6): `b6-topbar-reserved`, the room of the yellow demo bar's slot, is gone with the bar; nothing
 * else is reserved, so an ended state adds nothing off the entry routes.
 *
 * Plain ES5 (it runs before any bundle), one `localStorage` key read. The record is parsed only for its expiry
 * (a finite positive number inside the Date range, the same bounds the demo client's schema enforces); anything
 * else reads as "no live demo". Nothing is logged; storage being blocked or the record being malformed is not an
 * error. Kept in its own module so a test can execute it for real against jsdom.
 */
export const FIRST_PAINT_SCRIPT =
  "try{var c=document.documentElement.classList,p=location.pathname.replace(/\\/+$/,\"\"),x;" +
  'if(p===""||p==="/sign-in"||p==="/pair"||p==="/capture")c.add("b6-panel-reserved");' +
  `var r=localStorage.getItem(${JSON.stringify(DEMO_STATE_KEY)});` +
  'if(r){try{x=JSON.parse(r);x=x&&typeof x==="object"?x.expires_at_ms:void 0}catch(e){}' +
  'if(typeof x==="number"&&x>0&&x<=8.64e15&&Date.now()<x)c.add("b6-panel-reserved")}}catch(e){}';
