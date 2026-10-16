/**
 * R-24 eval fixture: fictional two-procedure SOP (§8, A4).
 *
 * Four sections derived from 8 steps: bake-dubai (3), bake-ube (3), serve (1), close (1).
 * Hard rule #8: entirely fictional, never real shop data.
 */

import type { SopStep } from "@/lib/firestore/schema";

export const FIXTURE_SOP_STEPS: readonly SopStep[] = [
  { step_id: "bake-dubai-01", title: "Mix and portion Dubai Chewy", role: "staff", text: "Mix the Dubai Chewy dough, fold in the pistachio filling and portion 80 g balls onto a lined tray." },
  { step_id: "bake-dubai-02", title: "Bake Dubai Chewy", role: "staff", text: "Bake the Dubai Chewy tray for 14 minutes at 170 C." },
  { step_id: "bake-dubai-03", title: "Rest and label Dubai Chewy", role: "staff", text: "Rest the Dubai Chewy cookies for 5 minutes on the tray, then label the box with the bake time." },
  { step_id: "bake-ube-01", title: "Mix and portion Ube", role: "staff", text: "Mix the Ube cookie dough with the ube halaya swirl and portion 70 g balls onto a lined tray." },
  { step_id: "bake-ube-02", title: "Bake Ube", role: "staff", text: "Bake the Ube tray for 12 minutes at 165 C." },
  { step_id: "bake-ube-03", title: "Cool and box Ube", role: "staff", text: "Cool the Ube cookies for 10 minutes on a rack, then box them and label the box with the bake time." },
  { step_id: "serve-01", title: "Serve a customer", role: "staff", text: "Greet, take the order, confirm it back, take payment." },
  { step_id: "close-01", title: "Close the shop", role: "supervisor", text: "Count the till, clean the oven, log leftover items." },
];
