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
  supervisor_visited: false,
  ...over,
});

describe("STAGES and GUIDE data", () => {
  it("has the 5 stages in journey order, bilingual", () => {
    expect(STAGES.map((s) => s.id)).toEqual(["staff_day1", "supervisor_look", "staff_days23", "supervisor_decide", "owner_approve"]);
    expect(STAGES.map((s) => s.title.en)).toEqual([
      "Staff · day 1",
      "Supervisor · look around",
      "Staff · days 2-3",
      "Supervisor · decide",
      "Owner · approve",
    ]);
    for (const s of STAGES) expect(s.title.id.trim().length).toBeGreaterThan(0);
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
    expect(GuideCardSchema.safeParse({ ...ok, body: [...ok.body, ok.body[0]] }).success).toBe(true); // 4 lines: allowed
    expect(GuideCardSchema.safeParse({ ...ok, body: [...ok.body, ok.body[0], ok.body[0]] }).success).toBe(false); // 5 lines: refused
    expect(GuideCardSchema.safeParse({ ...ok, action: { kind: "nope" } }).success).toBe(false);
    expect(GuideCardSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
  });

  it("wires the actions to the keys the plan names, and nowhere else", () => {
    const actions = Object.fromEntries(GUIDE_KEYS.map((k) => [k, GUIDE[k].action?.kind ?? null]));
    expect(actions.pair).toBe("fill_demo_code");
    expect(actions.capture_listening).toBe("script_card");
    expect(actions.capture_all_spoken).toBe("jump_closing");
    expect(actions.debrief_done).toBe("jump_tomorrow");
    expect(actions.debrief_question).toBe("jump_tomorrow");
    expect(actions.home).toBe("reset_demo");
    const others = GUIDE_KEYS.filter((k) => !["pair", "capture_listening", "capture_all_spoken", "debrief_done", "debrief_question", "home"].includes(k));
    for (const k of others) expect(actions[k], k).toBeNull();
  });

  it("the demo facts live only in the guide: the entry card says about 20 minutes and how to change role; the pair card fills the code through a placeholder, never the literal", () => {
    const entry = GUIDE.entry;
    expect(entry.body.map((b) => b.en).join(" ")).toMatch(/20 minutes/);
    expect(entry.footnote?.en).toBe("To change role later: sign out, then pick again.");
    expect(JSON.stringify(GUIDE)).not.toMatch(/\b0{6}\b/);
    expect(JSON.stringify(GUIDE.pair)).toContain("{code}");
  });

  it("the paired card (R-25 R12) names the next step, has no action and no demo code", () => {
    const c = GUIDE.pair_done;
    expect(c.title.en).toBe("Open the listening page");
    expect(c.body.map((b) => b.en).join(" ")).toBe("Tap Open the listening page. Then tap Start and read the script cards that appear in this guide.");
    expect(c.action).toBeNull();
    expect(JSON.stringify(c)).not.toContain("{code}");
    expect(JSON.stringify(c)).not.toMatch(/Fill in|Set up/);
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
      expect(body.id, `day ${day}`).toBe(body.en);
      expect(body.en.length, `day ${day}`).toBeLessThanOrEqual(240);
      expect(body.en, `day ${day}`).not.toMatch(/big order/);
    }
  });

  it("the day-1 debrief card never mentions the phone order (day 1 has no phone-order card): answer what really happened", () => {
    const text = guideCard("debrief_question", 1).body.map((b) => b.en).join(" ");
    expect(text).not.toMatch(/phone order/i);
    expect(text).toMatch(/what really happened in today's script/);
    expect(text).toMatch(/a few words/);
    expect(guideCard("debrief_question", 1).action).toEqual({ kind: "jump_tomorrow" });
  });

  it("the day-1 Complete card offers the Supervisor look-around before tomorrow (stage 2); days 2-3 keep the jump-to-tomorrow / after-day-3 wording", () => {
    const day1 = guideCard("debrief_done", 1).body.map((b) => b.en).join(" ");
    expect(day1).toMatch(/After day 1, you can sign out and look around as Supervisor first \(Proposals says Waiting for evidence\), then pair again and jump to tomorrow\./);
    expect(day1).toMatch(/Jump to tomorrow/);
    expect(guideCard("debrief_done", 1).action).toEqual({ kind: "jump_tomorrow" });
    const day2 = guideCard("debrief_done", 2).body.map((b) => b.en).join(" ");
    expect(day2).not.toMatch(/After day 1/);
    expect(day2).toMatch(/Jump to tomorrow to run the next day\./);
  });

  it("day 3 is the last day: neither debrief card tells the judge to jump to tomorrow (the max_days line sits next to it); both say sign out and continue as Supervisor", () => {
    for (const key of ["debrief_question", "debrief_done"] as const) {
      const text = guideCard(key, 3).body.map((b) => b.en).join(" ");
      expect(text, key).not.toMatch(/jump to tomorrow|run the next day/i);
      expect(text, key).toMatch(/Supervisor/);
    }
    // days 1 and 2 keep the jump wording
    for (const day of [1, 2] as const) {
      expect(guideCard("debrief_question", day).body.map((b) => b.en).join(" "), `day ${day}`).toMatch(/jump to tomorrow to run the next day/);
    }
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
      for (const day of [1, 2, 3, null] as const) {
        expect(() => GuideCardSchema.parse(guideCard(key, day)), `${key} day ${day}`).not.toThrow();
        expect(guideCard(key, day).body.length, `${key} day ${day}`).toBeLessThanOrEqual(4);
      }
      expect(guideCard(key, null), key).toBe(GUIDE[key]);
      if (key !== "debrief_question" && key !== "debrief_done") expect(guideCard(key, 1), key).toBe(GUIDE[key]);
    }
  });

  it("capture_ready has 4 body lines guiding the judge to read one line at a time with pauses", () => {
    const card = GUIDE.capture_ready;
    expect(card.body).toHaveLength(4);
    const lines = card.body.map((b) => b.en);
    expect(lines[0]).toMatch(/Tap Start.*one script card at a time/);
    expect(lines[1]).toMatch(/Read each card aloud and play every voice.*speaker tag is not spoken/);
    expect(lines[2]).toMatch(/Read one line at a time.*count slowly to three/);
    expect(lines[3]).toMatch(/After the 5 cards.*Jump to closing time unlocks End/);
  });

  it("capture_ready line 4 includes the R-23 stagger rule: No more than 4 people, wait for 5 cards", () => {
    const line4 = GUIDE.capture_ready.body[3]!.en;
    expect(line4).toMatch(/No more than 4 people should read cards at the same time/);
    expect(line4).toMatch(/wait until someone has finished their 5 cards/);
    expect(line4).toMatch(/about 2 minutes/);
    expect(line4.length).toBeLessThanOrEqual(240);
  });

  it("capture_listening has a footnote instructing to pause for a slow count of three between lines", () => {
    const card = GUIDE.capture_listening;
    expect(card.footnote?.en).toBe("Pause for a slow count of three between lines.");
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
    [{ days_done: 3, proposals_with_content: 1, feasible: 1, owner_decided: 1 }, "owner_approve"],
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
