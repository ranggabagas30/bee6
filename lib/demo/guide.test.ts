import { describe, expect, it } from "vitest";
import {
  GUIDE,
  GUIDE_KEYS,
  GuideCardSchema,
  STAGES,
  cardState,
  currentStage,
  guideCard,
  guideKeyFor,
  jumpLockText,
  phoneJourney,
  stageIndex,
  todoDoneCount,
  type CaptureGuideState,
  type JourneyProgress,
  type WebGuideState,
} from "@/lib/demo/guide";
import { SCRIPT_V2 } from "@/lib/demo/script";

/** R-19 PR-5 (plan section 7.1): the judge guide's pure data model. */

const progress = (over: Partial<JourneyProgress> = {}): JourneyProgress => ({
  day: 1,
  days_done: 0,
  proposals_with_content: 0,
  feasible: 0,
  owner_decided: 0,
  approved: 0,
  reviews_open: 0,
  reviews_confirmed: 0,
  supervisor_visited: false,
  ...over,
});

describe("STAGES and GUIDE data", () => {
  it("has the 7 stages in journey order, bilingual (review-agent plan 3.6: the two after stages come last)", () => {
    expect(STAGES.map((s) => s.id)).toEqual([
      "staff_day1",
      "supervisor_look",
      "staff_days23",
      "supervisor_decide",
      "owner_approve",
      "staff_after",
      "close_loop",
    ]);
    expect(STAGES.map((s) => s.title.en)).toEqual([
      "Staff · day 1",
      "Supervisor · look around",
      "Staff · days 2-3",
      "Supervisor · decide",
      "Owner · approve",
      "Staff · days 4-5",
      "Review · close the loop",
    ]);
    expect(STAGES.map((s) => s.title.id).slice(5)).toEqual(["Staf · hari 4-5", "Tinjauan · tutup siklus"]);
    for (const s of STAGES) expect(s.title.id.trim().length).toBeGreaterThan(0);
    expect(stageIndex("staff_after")).toBe(5);
    expect(stageIndex("close_loop")).toBe(6);
  });

  it("has one card per guide key, every card valid against the strict schema (1-4 body lines)", () => {
    expect(Object.keys(GUIDE).sort()).toEqual([...GUIDE_KEYS].sort());
    for (const key of GUIDE_KEYS) {
      const card = GUIDE[key];
      expect(() => GuideCardSchema.parse(card), key).not.toThrow();
      expect(card.body.length, key).toBeLessThanOrEqual(4);
    }
  });

  it("the schema allows up to 4 body lines but refuses 5 or more, and refuses an unknown action kind", () => {
    const ok = GUIDE.entry;
    const four = [ok.body[0]!, ok.body[0]!, ok.body[0]!, ok.body[0]!];
    expect(GuideCardSchema.safeParse({ ...ok, body: four }).success).toBe(true); // 4 lines: allowed
    expect(GuideCardSchema.safeParse({ ...ok, body: [...four, ok.body[0]] }).success).toBe(false); // 5 lines: refused
    expect(GuideCardSchema.safeParse({ ...ok, action: { kind: "nope" } }).success).toBe(false);
    expect(GuideCardSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
  });

  it("wires the actions to the keys the plan names, and nowhere else", () => {
    const actions = Object.fromEntries(GUIDE_KEYS.map((k) => [k, GUIDE[k].action?.kind ?? null]));
    expect(actions.pair).toBe("fill_demo_code");
    expect(actions.capture_listening).toBe("script_card");
    expect(actions.capture_all_spoken).toBe("jump_closing");
    expect(actions.debrief_done).toBe("jump_tomorrow");
    expect(actions.debrief_question).toBeNull(); // UI-112: no Jump control while questions are open
    expect(actions.home).toBe("reset_demo");
    expect(actions.sign_in_supervisor).toBe("fill_demo_credentials");
    expect(actions.sign_in_owner).toBe("fill_demo_credentials");
    const others = GUIDE_KEYS.filter(
      (k) => !["pair", "capture_listening", "capture_all_spoken", "debrief_done", "home", "sign_in_supervisor", "sign_in_owner"].includes(k),
    );
    for (const k of others) expect(actions[k], k).toBeNull();
  });

  it("the demo facts live only in the guide: the entry card says about 20 minutes and how to change role; the pair card fills the code through a placeholder, never the literal", () => {
    const entry = GUIDE.entry;
    expect(entry.body.map((b) => b.en).join(" ")).toMatch(/20 minutes/);
    expect(entry.footnote?.en).toBe("To change role later: sign out, then pick a role again.");
    expect(JSON.stringify(GUIDE)).not.toMatch(/\b0{6}\b/);
    expect(JSON.stringify(GUIDE.pair)).toContain("{code}");
    // Demo feedback 2, finding 4: the sign-in cards print the credentials through placeholders; no literal sits in copy.
    expect(JSON.stringify(GUIDE)).not.toMatch(/judge@example|bee6-demo/);
    for (const k of ["sign_in_supervisor", "sign_in_owner"] as const) {
      expect(JSON.stringify(GUIDE[k]), k).toContain("{email}");
      expect(JSON.stringify(GUIDE[k]), k).toContain("{password}");
    }
    expect(entry.body.map((b) => b.en).join(" ")).toContain("the email and password this guide shows on the sign-in page");
  });

  it("the paired card (R-25 R12) names the next step, has no action and no demo code", () => {
    const c = GUIDE.pair_done;
    expect(c.title.en).toBe("Open the listening page");
    expect(c.body.map((b) => b.en).join(" ")).toBe("Tap Open the listening page. Then tap Start and read the script cards that appear in this guide.");
    expect(c.action).toBeNull();
    expect(JSON.stringify(c)).not.toContain("{code}");
    expect(JSON.stringify(c)).not.toMatch(/Fill in|Set up/);
  });

  // Demo feedback 2 item 18: one tap of Ask writes every proposal the evidence allows; the card no longer says "one at a time".
  it("the proposals_ready card says one tap writes a proposal for each problem with enough evidence; the generating card says proposals", () => {
    const ready = GUIDE.proposals_ready.body.map((b) => b.en).join(" ");
    expect(ready).toMatch(/Tap Ask Bee6 once: it writes and checks one proposal for each problem that has enough evidence/);
    expect(ready).not.toMatch(/one at a time|Ask for another/);
    expect(GUIDE.proposals_ready.body.map((b) => b.id).join(" ")).not.toMatch(/sekali waktu|Minta lagi/);
    expect(GUIDE.proposals_generating.body.map((b) => b.en).join(" ")).toBe("Keep this page open. The proposals appear in about a minute.");
  });

  // The guide cannot know which Proposal agent the server runs (it is a static card table, outside the proposals page), so
  // the wait it names has to be true for both: ~20 s on the single-call agent, up to a minute or so on the checking agent.
  it("the Ask wait is worded for either agent: no '20 seconds' or 'half a minute' promise, in either language", () => {
    for (const key of ["proposals_ready", "proposals_generating"] as const) {
      const en = GUIDE[key].body.map((b) => b.en).join(" ");
      const id = GUIDE[key].body.map((b) => b.id).join(" ");
      expect(en, key).not.toMatch(/20 seconds|half a minute|30 seconds/);
      expect(id, key).not.toMatch(/20 detik|setengah menit|30 detik/);
      expect(en, key).toMatch(/a minute/);
      expect(id, key).toMatch(/satu menit/);
    }
  });

  it("never hard-codes which proposal comes first (focus order is ready, most facts, most dates, category order)", () => {
    const text = [GUIDE.proposals_ready, GUIDE.proposal_detail, GUIDE.proposals_feasible, GUIDE.approvals, GUIDE.approvals_done]
      .map((c) => JSON.stringify(c))
      .join(" ")
      .toLowerCase();
    expect(text).not.toMatch(/first proposal is|the first one is|egg tart.*first|phone.*first/);
    expect(text).not.toMatch(/five days later/);
  });

  it("the debrief card on days 2 and 3 tells the judge the phone order did happen: answer Yes and type a few words why", () => {
    for (const day of [2, 3] as const) {
      const text = guideCard("debrief_question", day).body.map((b) => b.en).join(" ");
      expect(text, `day ${day}`).toMatch(/phone order did happen/);
      expect(text, `day ${day}`).toMatch(/answer \*?Yes\*?/);
      expect(text, `day ${day}`).toMatch(/a few words/);
    }
  });

  it("the debrief card's example reason names the problem (R-21 F-1 safety net): not reading the order back to the caller", () => {
    for (const day of [2, 3] as const) {
      const body = guideCard("debrief_question", day).body[0]!;
      expect(body.en, `day ${day}`).toBe(
        "Answer what really happened in today's script. The phone order did happen, so answer Yes and type a few words why, for example: I did not read the order back to the caller.",
      );
      expect(body.id, `day ${day}`).toMatch(/Saya tidak membacakan ulang pesanan/);
      expect(body.en.length, `day ${day}`).toBeLessThanOrEqual(240);
      expect(body.en, `day ${day}`).not.toMatch(/big order/);
    }
  });

  it("UI-112: the question card has no Jump control on any day; the complete card keeps the action on every day (the component hides the button where the route would refuse)", () => {
    for (const day of [1, 2, 3, 4, 5, null] as const) expect(guideCard("debrief_question", day).action, `day ${day}`).toBeNull();
    for (const day of [1, 2, 3, 4, 5, null] as const) expect(guideCard("debrief_done", day).action, `day ${day}`).toEqual({ kind: "jump_tomorrow" });
  });

  it("the day-1 debrief card never mentions the phone order (day 1 has no phone-order card): answer what really happened", () => {
    const text = guideCard("debrief_question", 1).body.map((b) => b.en).join(" ");
    expect(text).not.toMatch(/phone order/i);
    expect(text).toMatch(/what really happened in today's script/);
    expect(text).toMatch(/a few words/);
    expect(guideCard("debrief_question", 1).action).toBeNull();
  });

  it("the day-1 Complete card offers the Supervisor look-around before tomorrow (stage 2); days 2-3 keep the jump-to-tomorrow / after-day-3 wording", () => {
    const day1 = guideCard("debrief_done", 1).body.map((b) => b.en).join(" ");
    expect(day1).toBe(
      "Day 1 of 5 is done. First sign out and look around as Supervisor (stage 2). Then come back for days 2 and 3. Asking Bee6 for proposals locks Jump to tomorrow, so finish day 3 first.",
    );
    expect(guideCard("debrief_done", 1).action).toEqual({ kind: "jump_tomorrow" });
    const day2 = guideCard("debrief_done", 2).body.map((b) => b.en).join(" ");
    expect(day2).not.toMatch(/After day 1/);
    expect(day2).toMatch(/Jump to tomorrow to run day 3\./);
  });

  it("day 3 still hands over to the Supervisor (the approve_first line sits next to it): neither debrief card tells the judge to jump to tomorrow; both say sign out and continue as Supervisor", () => {
    for (const key of ["debrief_question", "debrief_done"] as const) {
      const text = guideCard(key, 3).body.map((b) => b.en).join(" ");
      expect(text, key).not.toMatch(/jump to tomorrow|run the next day/i);
      expect(text, key).toMatch(/Supervisor/);
    }
    // days 1 and 2 keep the jump wording
    for (const day of [1, 2] as const) {
      expect(guideCard("debrief_question", day).body.map((b) => b.en).join(" "), `day ${day}`).toMatch(/this guide shows Jump to tomorrow/);
    }
  });

  // Review-agent plan 3.6: the debrief cards for the after days.
  it("the debrief_done cards say 'of 5' on every day and are day-aware for days 3, 4 and 5 (plan 3.6)", () => {
    const en = (day: number) => guideCard("debrief_done", day).body.map((b) => b.en).join(" ");
    expect(en(1)).toBe(
      "Day 1 of 5 is done. First sign out and look around as Supervisor (stage 2). Then come back for days 2 and 3. Asking Bee6 for proposals locks Jump to tomorrow, so finish day 3 first.",
    );
    expect(en(2)).toBe("Day 2 of 5 is done. Jump to tomorrow to run day 3. After day 3, sign out and continue as Supervisor.");
    expect(en(3)).toBe("That was day 3 of 5. Next, sign out and continue as Supervisor. Days 4 and 5 unlock after the Owner approves a change.");
    expect(en(4)).toBe("Day 4 of 5 is done. Jump to tomorrow to run day 5. After day 5, sign out and continue as Supervisor.");
    expect(en(5)).toBe("That was the last demo day. Sign out, continue as Supervisor, and open Reviews.");
    expect(guideCard("debrief_done", 3).handle?.en).toBe("Sign out and continue as Supervisor");
    expect(guideCard("debrief_done", 5).handle?.en).toBe("Sign out and open Reviews");
    // days 1, 2 and 4 keep the base handle ("Jump to tomorrow for day {next}")
    for (const day of [1, 2, 4] as const) expect(guideCard("debrief_done", day).handle?.en, `day ${day}`).toBe("Jump to tomorrow for day {next}");
    for (const day of [1, 2, 3, 4, 5] as const) expect(en(day), `day ${day}`).not.toMatch(/of 3/);
    // every variant has its own Bahasa line
    for (const day of [1, 2, 3, 4, 5] as const) {
      const c = guideCard("debrief_done", day);
      for (const line of c.body) expect(line.id, `day ${day}`).not.toBe(line.en);
    }
  });

  it("the debrief_question card: day 4 says the phone order was read back (answer Yes), day 5 hands over like day 3 (plan 3.6)", () => {
    const day4 = guideCard("debrief_question", 4);
    expect(day4.body[0]!.en).toBe(
      "Answer what really happened in today's script. The phone order did happen and was read back, so answer Yes and type a few words, for example: I read the order back to the caller.",
    );
    expect(day4.body[0]!.id).not.toBe(day4.body[0]!.en);
    expect(day4.body[0]!.en.length).toBeLessThanOrEqual(240);
    // the rest of the card is the base card, so day 4 still says when Jump to tomorrow appears
    expect(day4.body.slice(1)).toEqual(GUIDE.debrief_question.body.slice(1));
    const day5 = guideCard("debrief_question", 5);
    // day 5 has no phone-order question, so the first line is the neutral day-1 line, never the base phone-order line
    expect(day5.body[0]).toEqual(guideCard("debrief_question", 1).body[0]);
    expect(day5.body[0]!.en).not.toMatch(/phone/i);
    expect(day5.body[1]).toEqual(GUIDE.debrief_question.body[1]);
    expect(day5.body[2]!.en).toBe("When your questions are answered, sign out, continue as Supervisor, and open Reviews.");
    expect(day5.body[2]!.id).not.toBe(day5.body[2]!.en);
    // day 3 keeps the plain hand-over line
    expect(guideCard("debrief_question", 3).body[2]!.en).toBe("When your questions are answered, sign out and continue as Supervisor.");
  });

  it("the day-3 done card reads the phone's next_day.allowed: once the Owner approved, it says Jump to tomorrow for day 4 and keeps the handle and action; false or unset keeps the hand-over copy", () => {
    const approved = guideCard("debrief_done", 3, { nextDayAllowed: true });
    expect(approved.body.map((b) => b.en)).toEqual(["The Owner approved a change. Jump to tomorrow to run day 4 with the new SOP."]);
    expect(approved.body[0]!.id).toBe("Pemilik sudah menyetujui satu perubahan. Lompat ke besok untuk menjalankan hari 4 dengan SOP baru.");
    expect(approved.handle).toEqual(GUIDE.debrief_done.handle);
    expect(approved.action).toEqual({ kind: "jump_tomorrow" });
    for (const ctx of [{ nextDayAllowed: false }, {}] as const) {
      const waiting = guideCard("debrief_done", 3, ctx);
      expect(waiting.body[0]!.en).toBe("That was day 3 of 5. Next, sign out and continue as Supervisor. Days 4 and 5 unlock after the Owner approves a change.");
      expect(waiting.handle?.en).toBe("Sign out and continue as Supervisor");
    }
    // the flag is read only by the day-3 done card
    expect(guideCard("debrief_done", 2, { nextDayAllowed: true })).toEqual(guideCard("debrief_done", 2));
  });

  it("proposals_ready says the days 4 and 5 unlock only after day 3 is done and the Owner approves a change", () => {
    expect(GUIDE.proposals_ready.body[1]!.en).toBe(
      "If day 3 is not done yet, run it first: after you ask, Jump to tomorrow stays locked, and days 4 and 5 open only once day 3 is done and the Owner approves a change.",
    );
    expect(GUIDE.proposals_ready.body[1]!.id).toBe(
      "Jika hari 3 belum selesai, jalankan dulu: setelah Anda meminta, Lompat ke besok terkunci, dan hari 4 dan 5 baru terbuka setelah hari 3 selesai dan Pemilik menyetujui satu perubahan.",
    );
  });

  it("the open-session card matches the page: End today when closing is reached, Cancel today otherwise (never both)", () => {
    const reached = guideCard("capture_open_session", 1, { openClosingReached: true }).body.map((b) => b.en).join(" ");
    expect(reached).toMatch(/End today/);
    expect(reached).not.toMatch(/Cancel/);
    const interrupted = guideCard("capture_open_session", 1, { openClosingReached: false }).body.map((b) => b.en).join(" ");
    expect(interrupted).toMatch(/Cancel today/);
    expect(interrupted).not.toMatch(/End today/);
    expect(guideCard("capture_open_session", 1, { openClosingReached: false }).title.en).not.toBe(guideCard("capture_open_session", 1, { openClosingReached: true }).title.en);
    for (const o of [true, false]) expect(() => GuideCardSchema.parse(guideCard("capture_open_session", 2, { openClosingReached: o }))).not.toThrow();
  });

  it("guideCard: every day variant is valid against the strict schema; an unknown day and every other key fall back to the base card", () => {
    for (const key of GUIDE_KEYS) {
      for (const day of [1, 2, 3, 4, 5, null] as const) {
        expect(() => GuideCardSchema.parse(guideCard(key, day)), `${key} day ${day}`).not.toThrow();
        expect(guideCard(key, day).body.length, `${key} day ${day}`).toBeLessThanOrEqual(4);
      }
      expect(guideCard(key, null), key).toBe(GUIDE[key]);
      if (key !== "debrief_question" && key !== "debrief_done") expect(guideCard(key, 1), key).toBe(GUIDE[key]);
    }
  });

  it("capture_ready (R-25 T6): the board sentence first, then the one-line-at-a-time pacing rule and the R-23 stagger rule", () => {
    const card = GUIDE.capture_ready;
    expect(card.kicker?.en).toBe("NEXT");
    expect(card.body).toHaveLength(3);
    const lines = card.body.map((b) => b.en);
    expect(lines[0]).toBe("Tap **Start**. The first script card appears here. Read it word for word, then tap “I have spoken this”.");
    expect(lines[1]).toMatch(/Read one line at a time.*count slowly to three/);
    expect(lines[2]).toMatch(/After the 5 cards.*Jump to closing time unlocks End/);
  });

  it("capture_ready's last line keeps the R-23 stagger rule: No more than 4 people, wait for 5 cards", () => {
    const line = GUIDE.capture_ready.body[2]!.en;
    expect(line).toMatch(/No more than 4 people should read cards at the same time/);
    expect(line).toMatch(/wait until someone has finished their 5 cards/);
    expect(line).toMatch(/about 2 minutes/);
  });

  it("capture_listening carries the board's why-line (UI-107) and a handle with the card position", () => {
    const card = GUIDE.capture_listening;
    expect(card.footnote?.en).toBe(
      "Read it word for word. You play every voice; the speaker name is not spoken. Pause about 2 seconds between speakers.",
    );
    expect(card.handle?.en).toBe("Read card {n} of {total} aloud");
  });

  it("every handle line is the board's (UI-006); a card without its own handle uses its title", () => {
    const handles: Record<string, string> = {
      entry: "Welcome · pick Staff to start",
      sign_in_supervisor: "Supervisor email and password",
      sign_in_owner: "Owner email and password",
      pair: "Fill in the demo code",
      capture_listening: "Read card {n} of {total} aloud",
      capture_all_spoken: "All cards spoken · jump to closing",
      capture_closing: "All cards spoken · jump to closing",
      debrief_preparing: "Wait for your questions",
      debrief_question: "Answer the questions",
      debrief_done: "Jump to tomorrow for day {next}",
    };
    for (const [key, text] of Object.entries(handles)) expect(GUIDE[key as keyof typeof GUIDE].handle?.en, key).toBe(text);
    expect(GUIDE.pair_done.handle).toBeUndefined();
    expect(GUIDE.pair_done.title.en).toBe("Open the listening page");
    expect(GUIDE.capture_ready.title.en).toBe("Tap Start, then read the cards");
    expect(guideCard("debrief_done", 3).handle?.en).toBe("Sign out and continue as Supervisor");
  });

  it("the card kickers are the board's", () => {
    const kickers: Record<string, string> = {
      entry: "WELCOME, JUDGE",
      sign_in_supervisor: "SIGN IN AS SUPERVISOR",
      sign_in_owner: "SIGN IN AS OWNER",
      pair: "STEP: PAIR THE DEVICE",
      pair_done: "NEXT",
      capture_ready: "NEXT",
      capture_all_spoken: "ALL 5 CARDS SPOKEN",
      capture_closing: "CLOSING TIME REACHED",
      debrief_preparing: "PLEASE WAIT",
      debrief_question: "DEBRIEF TIP",
      debrief_done: "NEXT",
    };
    for (const [key, text] of Object.entries(kickers)) expect(GUIDE[key as keyof typeof GUIDE].kicker?.en, key).toBe(text);
  });

  it("every card has a Bahasa column of its own (UI-009), never the English text", () => {
    for (const key of GUIDE_KEYS) {
      const c = GUIDE[key];
      expect(c.title.id, key).not.toBe(c.title.en);
      for (const line of c.body) expect(line.id, key).not.toBe(line.en);
      for (const row of c.todo ?? []) expect(row.id, key).not.toBe(row.en);
    }
  });

  it("the web cards carry the board's \"Do this now\" rows (D2-02, D2-07, D2-08)", () => {
    expect(GUIDE.day.todo?.map((r) => r.en)).toEqual(["Confirm the note that needs your check", "Read the staff's debrief answers", "Open Proposals"]);
    expect(GUIDE.home.todo?.map((r) => r.en)).toEqual([
      "Supervisor marked both proposals feasible",
      "Open Approvals and review in order",
      "Approve or reject each proposal",
    ]);
    expect(GUIDE.approvals.todo).toHaveLength(3);
    // item 20: both proposals can be approved, so no card tells the owner to approve one and reject the other
    expect(GUIDE.approvals.title.en).toBe("Approve or reject each proposal");
    expect(GUIDE.approvals.body.map((l) => l.en)).toEqual(["Approve or reject each proposal; a rejection reason becomes a rule Bee6 respects."]);
    expect(GUIDE.approvals_done.body[0]!.en).toContain("Each approved change is now its own SOP version");
    for (const key of GUIDE_KEYS) {
      const c = GUIDE[key];
      const all = [c.title, ...c.body, ...(c.todo ?? [])].map((l) => l.en);
      expect(all.join(" | "), key).not.toMatch(/approve one|reject the other/i);
    }
    expect(GUIDE.proposal_detail.todo).toHaveLength(5);
    expect(GUIDE.proposals_waiting.todo).toHaveLength(4);
  });

  // Review-agent plan 3.6, D8: the 3-day path stays the default; the after days are an optional extra, said in the entry card.
  it("the entry card keeps 'three short days ... About 20 minutes' and says the two after days are optional (D8)", () => {
    const first = GUIDE.entry.body[0]!;
    expect(first.en).toBe(
      "Bee6 listens to a shop's day on one phone and turns speech into short work notes. You will run three short days as staff, check what Bee6 found as supervisor, then approve a change as owner. About 20 minutes. Optional: run two more days with the new SOP and watch Bee6 review the change (about 10 minutes more).",
    );
    expect(first.id).toMatch(/Opsional/);
    expect(GUIDE.entry.body).toHaveLength(2);
  });

  it("approvals_done offers the after days, and the Reviews base card explains the fast-forward order (plan 3.6)", () => {
    expect(GUIDE.approvals_done.body[0]!.en).toBe(
      "Each approved change is now its own SOP version. Open SOP to see the improved steps. If you approved a change, you can see whether it worked: sign out, pick Staff, and run days 4 and 5 with the new SOP; then open Reviews.",
    );
    expect(GUIDE.reviews.body[0]!.en).toBe(
      "An approved change gets a review date. For a real before-and-after, run days 4 and 5 as Staff first; then come back here and fast-forward to the review date. Fast-forwarding earlier compares against empty days and locks that review in.",
    );
  });

  it("the three review cards carry the plan's copy: ready has the do-now rows, verdict the second-change footnote, done the reset line (plan 3.6)", () => {
    const ready = GUIDE.reviews_ready;
    expect(ready.todo?.map((r) => r.en)).toEqual([
      "Tap Fast-forward to the review date",
      "Read Bee6's review and the before/after counts",
      "Give the Supervisor verdict, then confirm as Owner",
    ]);
    expect(ready.body.map((b) => b.en)).toEqual([
      "Days 4 and 5 are captured. Fast-forward to the review date: Bee6 compares the days before and after the change and suggests a verdict.",
    ]);
    expect(GUIDE.reviews_verdict.body.map((b) => b.en)).toEqual([
      "Read the before and after counts and Bee6's suggestion, then give your verdict. The Supervisor decides first; the Owner confirms, and the result is remembered.",
    ]);
    expect(GUIDE.reviews_verdict.footnote?.en).toBe("A second change? Fast-forward again.");
    expect(GUIDE.reviews_done.body.map((b) => b.en)).toEqual([
      "The loop is closed: the change shipped, was reviewed, and the verdict is remembered. That is one full cycle of Bee6. Reset the demo from the Owner home to run it again.",
    ]);
    for (const k of ["reviews_ready", "reviews_verdict", "reviews_done"] as const) expect(GUIDE[k].action, k).toBeNull();
  });

  it("no card still says the demo is 3 days long, except the entry card's 'three short days' and the day-1 'days 2 and 3' lines (D8)", () => {
    for (const key of GUIDE_KEYS) {
      const all = JSON.stringify(GUIDE[key]).toLowerCase();
      expect(all, key).not.toMatch(/of 3\b|3 demo days|last of the 3/);
    }
  });
});

describe("todoDoneCount (R-25 T6: which Do this now rows are ticked)", () => {
  it("home: the first row is done once both proposals are feasible; approvals: one row per decision", () => {
    expect(todoDoneCount("home", null)).toBe(0);
    expect(todoDoneCount("home", progress({ feasible: 1 }))).toBe(0);
    expect(todoDoneCount("home", progress({ feasible: 2 }))).toBe(1);
    expect(todoDoneCount("approvals", progress({ owner_decided: 0 }))).toBe(0);
    expect(todoDoneCount("approvals", progress({ owner_decided: 1 }))).toBe(1);
    expect(todoDoneCount("approvals", progress({ owner_decided: 5 }))).toBe(2);
  });

  it("waiting: day 1 recorded, then the look-around once the supervisor is here; detail: the days and the ask are done", () => {
    expect(todoDoneCount("proposals_waiting", progress({ days_done: 1 }))).toBe(1);
    expect(todoDoneCount("proposals_waiting", progress({ days_done: 1, supervisor_visited: true }))).toBe(2);
    expect(todoDoneCount("proposal_detail", progress({ days_done: 3, proposals_with_content: 2 }))).toBe(2);
    expect(todoDoneCount("proposal_detail", progress({ days_done: 3, proposals_with_content: 2, feasible: 1 }))).toBe(3);
    expect(todoDoneCount("day", progress())).toBe(0);
  });

  it("reviews_ready: no row is ticked, even when a review exists (the second change starts again at the first row)", () => {
    expect(todoDoneCount("reviews_ready", null)).toBe(0);
    expect(todoDoneCount("reviews_ready", progress({ approved: 2, days_done: 5 }))).toBe(0);
    expect(todoDoneCount("reviews_ready", progress({ approved: 2, days_done: 5, reviews_confirmed: 1 }))).toBe(0);
    expect(todoDoneCount("reviews_ready", progress({ approved: 2, days_done: 5, reviews_open: 1 }))).toBe(0);
  });
});

describe("phoneJourney (the phone knows only the day it is on and its next_day status)", () => {
  const no = { allowed: false, reason: "day_not_ended" } as const;
  const approveFirst = { allowed: false, reason: "approve_first" } as const;
  const yes = { allowed: true, reason: null } as const;
  const reviewExists = { allowed: false, reason: "review_exists" } as const;

  it("before day 4 the phone reports no web counters: stages are the same as before the after days existed", () => {
    expect(phoneJourney({ day: 1, days_done: 0, next_day: no }, false)).toEqual(progress({ day: 1, days_done: 0 }));
    expect(currentStage(phoneJourney({ day: 3, days_done: 3, next_day: approveFirst }, true))).toBe("supervisor_decide");
  });

  it("on day 4 or 5 the judge has passed the approve_first guard, so the phone reports the change as approved: stage 6, then 7 after day 5", () => {
    expect(phoneJourney({ day: 4, days_done: 3, next_day: no }, true)).toEqual(
      progress({ day: 4, days_done: 3, proposals_with_content: 1, feasible: 1, owner_decided: 1, approved: 1, supervisor_visited: true }),
    );
    expect(currentStage(phoneJourney({ day: 4, days_done: 3, next_day: no }, true))).toBe("staff_after");
    expect(currentStage(phoneJourney({ day: 5, days_done: 4, next_day: no }, true))).toBe("staff_after");
    expect(currentStage(phoneJourney({ day: 5, days_done: 5, next_day: { allowed: false, reason: "max_days" } }, true))).toBe("close_loop");
  });

  it("day 3 with the jump allowed means the Owner approved a change: stage 6 (staff_after); approve_first keeps stage 4", () => {
    expect(currentStage(phoneJourney({ day: 3, days_done: 3, next_day: yes }, true))).toBe("staff_after");
    expect(phoneJourney({ day: 3, days_done: 3, next_day: yes }, true)).toEqual(
      progress({ day: 3, days_done: 3, proposals_with_content: 1, feasible: 1, owner_decided: 1, approved: 1, supervisor_visited: true }),
    );
    expect(currentStage(phoneJourney({ day: 3, days_done: 3, next_day: approveFirst }, true))).toBe("supervisor_decide");
  });

  it("a review that exists closes the loop (stage 7) on day 3 or day 4", () => {
    for (const day of [3, 4] as const) {
      const p = phoneJourney({ day, days_done: day, next_day: reviewExists }, true);
      expect(p.reviews_open, `day ${day}`).toBe(1);
      expect(p.approved, `day ${day}`).toBe(1);
      expect(currentStage(p), `day ${day}`).toBe("close_loop");
    }
  });
});

describe("currentStage (exact rule of plan 7.1)", () => {
  it.each<[Partial<JourneyProgress>, string]>([
    [{ days_done: 0 }, "staff_day1"],
    [{ days_done: 1, supervisor_visited: false }, "supervisor_look"],
    [{ days_done: 1, supervisor_visited: true }, "staff_days23"],
    [{ days_done: 2, supervisor_visited: true }, "staff_days23"],
    [{ days_done: 2, supervisor_visited: false }, "staff_days23"],
    [{ days_done: 3, supervisor_visited: true, proposals_with_content: 0 }, "supervisor_decide"],
    [{ days_done: 2, proposals_with_content: 1, feasible: 0 }, "supervisor_decide"],
    [{ days_done: 3, proposals_with_content: 2, feasible: 1 }, "supervisor_decide"],
    [{ days_done: 3, proposals_with_content: 2, feasible: 2 }, "owner_approve"],
    [{ days_done: 3, proposals_with_content: 2, feasible: 2, owner_decided: 1 }, "owner_approve"],
    // review-agent plan 3.6: the after stages. Everything decided and one change approved opens the after days...
    [{ days_done: 3, proposals_with_content: 2, feasible: 2, owner_decided: 2, approved: 1 }, "staff_after"],
    [{ days_done: 4, proposals_with_content: 2, feasible: 2, owner_decided: 2, approved: 2 }, "staff_after"],
    // ...day 5 done, or a review waiting or confirmed, closes the loop. Nothing approved yet (the Owner has not approved a change, e.g. rejected all) stays at Owner · approve.
    [{ days_done: 5, proposals_with_content: 2, feasible: 2, owner_decided: 2, approved: 2 }, "close_loop"],
    [{ days_done: 3, proposals_with_content: 2, feasible: 2, owner_decided: 2, approved: 2, reviews_open: 1 }, "close_loop"],
    [{ days_done: 3, proposals_with_content: 2, feasible: 2, owner_decided: 2, approved: 2, reviews_confirmed: 1 }, "close_loop"],
    [{ days_done: 3, proposals_with_content: 1, feasible: 1, owner_decided: 1, approved: 0 }, "owner_approve"],
  ])("%j -> %s", (over, stage) => {
    expect(currentStage(progress(over))).toBe(stage);
  });
});

// R-25 R7 (UI-052): after day 1 the supervisor guide on a supervisor web page says STAGE 2, with or without the
// local "supervisor visited" flag; on the phone the flag still moves the judge on to stage 3.
describe("currentStage with the page context (R-25 R7)", () => {
  const web = { onSupervisorWeb: true };
  const phone = { onSupervisorWeb: false };
  it.each<[string, Partial<JourneyProgress>, { onSupervisorWeb: boolean } | undefined, string]>([
    ["day 1 done, not visited, supervisor web", { days_done: 1, supervisor_visited: false }, web, "supervisor_look"],
    ["day 1 done, visited, supervisor web", { days_done: 1, supervisor_visited: true }, web, "supervisor_look"],
    ["day 1 done, visited, phone", { days_done: 1, supervisor_visited: true }, phone, "staff_days23"],
    ["day 1 done, not visited, phone", { days_done: 1, supervisor_visited: false }, phone, "supervisor_look"],
    ["no ctx behaves as the phone (visited)", { days_done: 1, supervisor_visited: true }, undefined, "staff_days23"],
    ["no ctx behaves as the phone (not visited)", { days_done: 1, supervisor_visited: false }, undefined, "supervisor_look"],
    ["no day done, supervisor web", { days_done: 0, supervisor_visited: true }, web, "staff_day1"],
    ["no day done, not visited, supervisor web", { days_done: 0 }, web, "staff_day1"],
    ["no day done, phone", { days_done: 0 }, phone, "staff_day1"],
    ["day 2 done, no proposals, supervisor web", { days_done: 2, supervisor_visited: true }, web, "staff_days23"],
    ["day 2 done, no proposals, not visited, supervisor web", { days_done: 2, supervisor_visited: false }, web, "staff_days23"],
    ["day 2 done, a proposal, supervisor web", { days_done: 2, proposals_with_content: 1, feasible: 0 }, web, "supervisor_decide"],
    ["day 3 done, all feasible, supervisor web", { days_done: 3, proposals_with_content: 2, feasible: 2 }, web, "owner_approve"],
  ])("%s -> %s", (_name, over, ctx, stage) => {
    expect(currentStage(progress(over), ctx)).toBe(stage);
  });
});

describe("guideKeyFor (route x state table)", () => {
  const cap = (phase: CaptureGuideState["phase"]): CaptureGuideState => ({ kind: "capture", phase });
  const web = (role: WebGuideState["role"], over: Partial<JourneyProgress> | null = {}, screen: WebGuideState["screen"] = null): WebGuideState => ({
    kind: "web",
    role,
    progress: over === null ? null : progress(over),
    screen,
  });

  it("entry and pairing routes need no state", () => {
    expect(guideKeyFor("/", null)).toBe("entry");
    expect(guideKeyFor("/sign-in", null)).toBe("entry");
    expect(guideKeyFor("/pair", null)).toBe("pair");
    expect(guideKeyFor("/pair", { kind: "pair", paired: false })).toBe("pair");
    expect(guideKeyFor("/pair", { kind: "pair", paired: true })).toBe("pair_done");
    expect(guideKeyFor("/pair/", { kind: "pair", paired: true })).toBe("pair_done");
    // a stale paired signal never leaks onto another route
    expect(guideKeyFor("/capture", { kind: "pair", paired: true })).toBe("capture_ready");
    expect(guideKeyFor("/", { kind: "pair", paired: true })).toBe("entry");
  });

  it("/sign-in follows the role the sign-in panel publishes; staff, no role and no state read as the entry card", () => {
    expect(guideKeyFor("/sign-in", { kind: "sign_in", role: "supervisor" })).toBe("sign_in_supervisor");
    expect(guideKeyFor("/sign-in", { kind: "sign_in", role: "owner" })).toBe("sign_in_owner");
    expect(guideKeyFor("/sign-in", { kind: "sign_in", role: "staff" })).toBe("entry");
    expect(guideKeyFor("/sign-in", { kind: "sign_in", role: null })).toBe("entry");
    expect(guideKeyFor("/sign-in", null)).toBe("entry");
    // a stale sign-in signal never leaks onto another route
    expect(guideKeyFor("/", { kind: "sign_in", role: "owner" })).toBe("entry");
    expect(guideKeyFor("/pair", { kind: "sign_in", role: "owner" })).toBe("pair");
  });

  it("/capture follows the phone's phase; no phase reads as the Start-ready card", () => {
    expect(guideKeyFor("/capture", null)).toBe("capture_ready");
    expect(guideKeyFor("/capture", cap("ready"))).toBe("capture_ready");
    expect(guideKeyFor("/capture", cap("listening"))).toBe("capture_listening");
    expect(guideKeyFor("/capture", cap("all_spoken"))).toBe("capture_all_spoken");
    expect(guideKeyFor("/capture", cap("closing"))).toBe("capture_closing");
    expect(guideKeyFor("/capture", cap("open_session"))).toBe("capture_open_session");
    expect(guideKeyFor("/capture", cap("debrief_preparing"))).toBe("debrief_preparing");
    expect(guideKeyFor("/capture", cap("debrief_question"))).toBe("debrief_question");
    expect(guideKeyFor("/capture", cap("debrief_done"))).toBe("debrief_done");
  });

  it("supervisor web routes", () => {
    expect(guideKeyFor("/day", web("supervisor"))).toBe("day");
    expect(guideKeyFor("/day/2026-10-12", web("supervisor"))).toBe("day");
    expect(guideKeyFor("/questions", web("supervisor"))).toBe("day");
    expect(guideKeyFor("/sop", web("supervisor"))).toBe("sop");
    expect(guideKeyFor("/reviews", web("supervisor"))).toBe("reviews");
    expect(guideKeyFor("/devices", web("supervisor"))).toBe("devices");
  });

  it("supervisor /proposals: waiting before 2 days, ready from 2 days, then detail until every proposal is marked feasible, then the hand-over; a page-reported screen wins", () => {
    expect(guideKeyFor("/proposals", web("supervisor", null))).toBe("proposals_waiting");
    expect(guideKeyFor("/proposals", web("supervisor", { days_done: 1 }))).toBe("proposals_waiting");
    expect(guideKeyFor("/proposals", web("supervisor", { days_done: 2 }))).toBe("proposals_ready");
    expect(guideKeyFor("/proposals", web("supervisor", { days_done: 3, proposals_with_content: 1, feasible: 0 }))).toBe("proposal_detail");
    expect(guideKeyFor("/proposals", web("supervisor", { days_done: 3, proposals_with_content: 2, feasible: 1 }))).toBe("proposal_detail");
    expect(guideKeyFor("/proposals", web("supervisor", { days_done: 3, proposals_with_content: 2, feasible: 2 }))).toBe("proposals_feasible");
    expect(guideKeyFor("/proposals", web("supervisor", { days_done: 3 }, "generating"))).toBe("proposals_generating");
    expect(guideKeyFor("/proposals", web("supervisor", { days_done: 3, proposals_with_content: 2, feasible: 2 }, "detail"))).toBe("proposal_detail");
  });

  // After-merge wiring: the proposals page reports its screen through lib/demo/proposals-signal; the supervisor's
  // `list` screen says nothing on its own (the counters decide between waiting, ready and detail).
  it("supervisor /proposals: the page's `feasible` screen is the hand-over even before the counters catch up; `list` falls back to the counters", () => {
    expect(guideKeyFor("/proposals", web("supervisor", { days_done: 3, proposals_with_content: 2, feasible: 1 }, "feasible"))).toBe("proposals_feasible");
    expect(guideKeyFor("/proposals", web("supervisor", { days_done: 1 }, "list"))).toBe("proposals_waiting");
    expect(guideKeyFor("/proposals", web("supervisor", { days_done: 2 }, "list"))).toBe("proposals_ready");
    expect(guideKeyFor("/proposals", web("supervisor", { days_done: 3, proposals_with_content: 1 }, "list"))).toBe("proposal_detail");
    // an owner-only screen reported while the supervisor card is computed (a stale signal) changes nothing
    expect(guideKeyFor("/proposals", web("supervisor", { days_done: 2 }, "all_decided"))).toBe("proposals_ready");
  });

  it("owner web routes: home, approvals until every proposal is decided, then all decided", () => {
    expect(guideKeyFor("/home", web("owner"))).toBe("home");
    expect(guideKeyFor("/proposals", web("owner", null))).toBe("approvals");
    expect(guideKeyFor("/proposals", web("owner", { proposals_with_content: 2, feasible: 2, owner_decided: 1 }))).toBe("approvals");
    expect(guideKeyFor("/proposals", web("owner", { proposals_with_content: 2, feasible: 2, owner_decided: 2 }))).toBe("approvals_done");
    expect(guideKeyFor("/sop", web("owner"))).toBe("sop");
    expect(guideKeyFor("/reviews", web("owner"))).toBe("reviews");
  });

  // Review-agent plan 3.6 reviewsKey: confirmed >= approved -> done; a review waiting -> verdict; day 5 done -> ready; else base.
  it.each<[string, Partial<JourneyProgress> | null, string]>([
    ["no progress yet", null, "reviews"],
    ["nothing approved", { approved: 0, days_done: 5 }, "reviews"],
    ["approved but the after days not done", { approved: 2, days_done: 3 }, "reviews"],
    ["approved, day 4 done", { approved: 2, days_done: 4 }, "reviews"],
    ["approved, day 5 done, no review yet", { approved: 2, days_done: 5 }, "reviews_ready"],
    ["a review is waiting", { approved: 2, days_done: 5, reviews_open: 1 }, "reviews_verdict"],
    ["a review is waiting before the after days (fast-forward on the 3-day path)", { approved: 2, days_done: 3, reviews_open: 1 }, "reviews_verdict"],
    ["one of two confirmed, none open", { approved: 2, days_done: 5, reviews_confirmed: 1 }, "reviews_ready"],
    ["one of two confirmed, the other open", { approved: 2, days_done: 5, reviews_confirmed: 1, reviews_open: 1 }, "reviews_verdict"],
    ["every approved change confirmed", { approved: 2, days_done: 5, reviews_confirmed: 2 }, "reviews_done"],
    ["confirmed on the 3-day path (fast-forward without the after days)", { approved: 1, days_done: 3, reviews_confirmed: 1 }, "reviews_done"],
  ])("/reviews, both web roles: %s -> %s", (_name, over, key) => {
    for (const role of ["supervisor", "owner"] as const) expect(guideKeyFor("/reviews", web(role, over))).toBe(key);
  });

  it("owner /proposals: the page's `all_decided` screen is the done card at once (the progress refetch may still be in flight); `review` and `empty` leave it to the counters; a supervisor screen is ignored", () => {
    expect(guideKeyFor("/proposals", web("owner", { proposals_with_content: 2, feasible: 2, owner_decided: 1 }, "all_decided"))).toBe("approvals_done");
    expect(guideKeyFor("/proposals", web("owner", null, "all_decided"))).toBe("approvals_done");
    expect(guideKeyFor("/proposals", web("owner", { proposals_with_content: 2, feasible: 2, owner_decided: 1 }, "review"))).toBe("approvals");
    expect(guideKeyFor("/proposals", web("owner", { proposals_with_content: 2, feasible: 2, owner_decided: 2 }, "review"))).toBe("approvals_done");
    expect(guideKeyFor("/proposals", web("owner", { proposals_with_content: 0 }, "empty"))).toBe("approvals");
    expect(guideKeyFor("/proposals", web("owner", { proposals_with_content: 2, feasible: 2, owner_decided: 1 }, "generating"))).toBe("approvals");
  });

  it("every key is reachable, and an unknown route falls back to the entry card", () => {
    const reached = new Set<string>([
      guideKeyFor("/", null),
      guideKeyFor("/pair", null),
      guideKeyFor("/pair", { kind: "pair", paired: true }),
      guideKeyFor("/sign-in", { kind: "sign_in", role: "supervisor" }),
      guideKeyFor("/sign-in", { kind: "sign_in", role: "owner" }),
      ...(["ready", "listening", "all_spoken", "closing", "open_session", "debrief_preparing", "debrief_question", "debrief_done"] as const).map((p) =>
        guideKeyFor("/capture", cap(p)),
      ),
      guideKeyFor("/day", web("supervisor")),
      guideKeyFor("/proposals", web("supervisor", { days_done: 1 })),
      guideKeyFor("/proposals", web("supervisor", { days_done: 2 })),
      guideKeyFor("/proposals", web("supervisor", { days_done: 3 }, "generating")),
      guideKeyFor("/proposals", web("supervisor", { proposals_with_content: 1 })),
      guideKeyFor("/proposals", web("supervisor", { proposals_with_content: 1, feasible: 1 })),
      guideKeyFor("/sop", web("supervisor")),
      guideKeyFor("/reviews", web("supervisor")),
      guideKeyFor("/reviews", web("supervisor", { approved: 2, days_done: 5 })),
      guideKeyFor("/reviews", web("supervisor", { approved: 2, days_done: 5, reviews_open: 1 })),
      guideKeyFor("/reviews", web("owner", { approved: 2, days_done: 5, reviews_confirmed: 2 })),
      guideKeyFor("/devices", web("supervisor")),
      guideKeyFor("/home", web("owner")),
      guideKeyFor("/proposals", web("owner")),
      guideKeyFor("/proposals", web("owner", { proposals_with_content: 1, owner_decided: 1 })),
    ]);
    expect([...reached].sort()).toEqual([...GUIDE_KEYS].sort());
    expect(guideKeyFor("/nowhere", null)).toBe("entry");
  });
});

describe("cardState and jumpLockText (plan 5.3-5.4)", () => {
  const cards = SCRIPT_V2[1];

  it("the active card is the first unspoken one; I have spoken this enables after 1 heard line", () => {
    expect(cardState({ cards, spoken: [], linesSinceCardShown: 0 })).toEqual({ index: 0, total: 5, allSpoken: false, canMarkSpoken: false });
    expect(cardState({ cards, spoken: [], linesSinceCardShown: 1 })).toEqual({ index: 0, total: 5, allSpoken: false, canMarkSpoken: true });
    expect(cardState({ cards, spoken: ["d1-c1", "d1-c2"], linesSinceCardShown: 3 })).toEqual({ index: 2, total: 5, allSpoken: false, canMarkSpoken: true });
  });

  it("all 5 spoken: allSpoken, index stays on the last card, nothing more to mark", () => {
    expect(cardState({ cards, spoken: cards.map((c) => c.id), linesSinceCardShown: 9 })).toEqual({ index: 4, total: 5, allSpoken: true, canMarkSpoken: false });
  });

  it("ids from another day or junk in storage are ignored", () => {
    expect(cardState({ cards, spoken: ["d2-c1", "nope", "d1-c1"], linesSinceCardShown: 0 }).index).toBe(1);
  });

  it("the locked-jump text is exactly the plan's W4 string", () => {
    expect(jumpLockText("en", 2, 5)).toBe("Locked until all 5 cards are spoken (2 of 5 done).");
    expect(jumpLockText("id", 0, 5)).toMatch(/5/);
  });
});
