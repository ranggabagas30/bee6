import { describe, expect, it } from "vitest";
import type { SopStep } from "@/lib/firestore/schema";
import type { Candidate } from "@/lib/proposals/candidates";
import {
  scopeMixedRows,
  scopeUbeRows,
} from "@/lib/proposals/testing/rehearsal-fixture";
import { checkCtx, makeWorld, validDraft, type V4World } from "@/lib/proposals/testing/v4-world";
import { checkProposalV4, normalizeForCheck } from "@/lib/proposals/v4/check";
import type { ProposalDraftV4 } from "@/lib/proposals/v4/draft-schema";
import { V4_RULES, type ProposalCheckResult, type V4CheckContext } from "@/lib/proposals/v4/types";
import { DEMO_SOP_V1 } from "@/scripts/demo-sop";

const passedOf = (r: ProposalCheckResult, rule: string): boolean | undefined =>
  r.checks.find((c) => c.rule === rule)?.passed;

/** Everything passes except (maybe) the rule under test: only that rule is allowed to be the one that fails. */
function expectOnlyFails(r: ProposalCheckResult, rule: string): void {
  expect(passedOf(r, rule)).toBe(false);
  expect(r.checks.filter((c) => !c.passed).map((c) => c.rule)).toEqual([rule]);
  expect(r.fired_rule).toBe(rule);
  expect(r.passed).toBe(false);
}

/** Swap in hand-written evidence (fictional): E1 on 13 Oct, E2 on 14 Oct, both CORRECTION. */
function withEvidence(w: V4World, texts: { summary: string; excerpt: string; note?: string }[]): V4CheckContext {
  const map = new Map<string, Candidate>();
  texts.forEach((t, i) => {
    map.set(`E${i + 1}`, {
      thread_id: `t${i + 1}`,
      local_date: i === 0 ? "2026-10-13" : "2026-10-14",
      start_hm: "15:00",
      category: "CORRECTION",
      first_line_start_ms: i + 1,
      summary: t.summary,
      excerpt: t.excerpt,
    });
  });
  const reasons = new Map<string, string>();
  texts.forEach((t, i) => t.note && reasons.set(`t${i + 1}`, t.note));
  return checkCtx(w, {
    aliasToCandidate: map,
    reasons,
    gateCtx: { ...w.gateCtx, aliasToCandidate: map },
  });
}

describe("checkProposalV4 (pcheck-v4)", () => {
  const w = makeWorld();

  it("a fully valid draft passes: 8 pgate-v1 checks then the 10 v4 rules, 18 in all, nothing fired", () => {
    const r = checkProposalV4(validDraft(), checkCtx(w));
    expect(r.passed).toBe(true);
    expect(r.fired_rule).toBeNull();
    expect(r.reasons).toEqual([]);
    expect(r.checks).toHaveLength(18);
    expect(r.checks.slice(8).map((c) => c.rule)).toEqual([...V4_RULES]);
    expect(r.checks.every((c) => c.passed)).toBe(true);
  });

  describe("section_not_fetched", () => {
    it("fires when the target section was never fetched", () => {
      const r = checkProposalV4(validDraft(), checkCtx(w, { fetchedSections: new Set() }));
      expectOnlyFails(r, "section_not_fetched");
      expect(r.reasons).toEqual(["section_not_fetched"]);
    });
    it("does not fire once it was fetched", () => {
      expect(passedOf(checkProposalV4(validDraft(), checkCtx(w)), "section_not_fetched")).toBe(true);
    });
  });

  describe("step_not_in_section", () => {
    it("fires when the step belongs to a different section", () => {
      const r = checkProposalV4(validDraft({ target_step_id: "bake-ube-02" }), checkCtx(w));
      expect(passedOf(r, "step_not_in_section")).toBe(false);
      expect(r.reasons).toContain("step_not_in_section");
    });
    it("does not fire for a step of the section, or for NEW", () => {
      expect(passedOf(checkProposalV4(validDraft(), checkCtx(w)), "step_not_in_section")).toBe(true);
      const created = checkProposalV4(
        validDraft({ target_step_id: "NEW", change_text: "A brand new step about preheating the oven." }),
        checkCtx(w),
      );
      expect(passedOf(created, "step_not_in_section")).toBe(true);
    });
  });

  describe("evidence_not_inspected", () => {
    it("fires when a cited alias was never read with get_evidence", () => {
      const r = checkProposalV4(validDraft(), checkCtx(w, { inspectedAliases: new Set(["E1"]) }));
      expectOnlyFails(r, "evidence_not_inspected");
    });
    it("does not fire when every cited alias was read", () => {
      expect(passedOf(checkProposalV4(validDraft(), checkCtx(w)), "evidence_not_inspected")).toBe(true);
    });
  });

  describe("intervention_not_inspected", () => {
    it("fires when the chosen intervention was never read", () => {
      const r = checkProposalV4(validDraft(), checkCtx(w, { inspectedInterventions: new Set(["add_script"]) }));
      expectOnlyFails(r, "intervention_not_inspected");
    });
    it("does not fire when it was read", () => {
      expect(passedOf(checkProposalV4(validDraft(), checkCtx(w)), "intervention_not_inspected")).toBe(true);
    });
  });

  describe("quote_alias_not_cited", () => {
    it("fires when a quote belongs to an alias that is not in `evidence`", () => {
      const draft = validDraft({
        evidence: ["E1"],
        evidence_quotes: [
          { alias: "E1", quote: "came out flat and dark" },
          { alias: "E2", quote: "before the oven was back at temperature" },
        ],
      });
      const r = checkProposalV4(draft, checkCtx(w));
      expect(passedOf(r, "quote_alias_not_cited")).toBe(false);
      expect(r.reasons).toContain("quote_alias_not_cited");
    });
    it("does not fire when every quoted alias is cited", () => {
      expect(passedOf(checkProposalV4(validDraft(), checkCtx(w)), "quote_alias_not_cited")).toBe(true);
    });
  });

  describe("quotes_insufficient", () => {
    it("fires with quotes from only one distinct alias (two quotes of the same fact still count once)", () => {
      const draft = validDraft({
        evidence_quotes: [
          { alias: "E1", quote: "came out flat and dark" },
          { alias: "E1", quote: "tray in before the oven" },
        ],
      });
      const r = checkProposalV4(draft, checkCtx(w));
      expectOnlyFails(r, "quotes_insufficient");
    });
    it("does not fire with quotes from two distinct aliases", () => {
      expect(passedOf(checkProposalV4(validDraft(), checkCtx(w)), "quotes_insufficient")).toBe(true);
    });
  });

  describe("quote_not_in_evidence", () => {
    it("fires on a paraphrase", () => {
      const draft = validDraft({
        evidence_quotes: [
          { alias: "E1", quote: "cookies were burnt and flat" },
          { alias: "E2", quote: "before the oven was back at temperature" },
        ],
      });
      const r = checkProposalV4(draft, checkCtx(w));
      expectOnlyFails(r, "quote_not_in_evidence");
    });
    it("passes through case, quote-mark and whitespace differences", () => {
      const draft = validDraft({
        evidence_quotes: [
          { alias: "E1", quote: "  CAME   out\nflat AND dark!  " },
          { alias: "E2", quote: "Before the oven was back at TEMPERATURE." },
        ],
      });
      expect(passedOf(checkProposalV4(draft, checkCtx(w)), "quote_not_in_evidence")).toBe(true);
    });
    it("matches against the summary and the staff note too, not only the excerpt", () => {
      const ctx = withEvidence(w, [
        { summary: "Dubai Chewy tray flat.", excerpt: "oven was cold", note: "we loaded the tray too early" },
        { summary: "Dubai Chewy tray flat and dark again.", excerpt: "oven was cold again" },
      ]);
      const draft = validDraft({
        evidence_quotes: [
          { alias: "E1", quote: "loaded the tray too early" },
          { alias: "E2", quote: "Dubai Chewy tray flat and dark" },
        ],
      });
      expect(passedOf(checkProposalV4(draft, ctx), "quote_not_in_evidence")).toBe(true);
    });
    it("fires for a quote whose alias is unknown, and for a quote that is only punctuation", () => {
      const unknown = validDraft({
        evidence_quotes: [
          { alias: "E1", quote: "came out flat and dark" },
          { alias: "E9", quote: "before the oven was back at temperature" },
        ],
      });
      expect(passedOf(checkProposalV4(unknown, checkCtx(w)), "quote_not_in_evidence")).toBe(false);
      const punct = validDraft({
        evidence_quotes: [
          { alias: "E1", quote: "came out flat and dark" },
          { alias: "E2", quote: "?!?!?!?!?!" },
        ],
      });
      expect(passedOf(checkProposalV4(punct, checkCtx(w)), "quote_not_in_evidence")).toBe(false);
    });
  });

  describe("scope_unsupported", () => {
    it("fires: Ube facts cited for a Dubai section target", () => {
      const ube = makeWorld({ rows: scopeUbeRows });
      const ctx = checkCtx(ube, { fetchedSections: new Set(["bake-dubai"]) });
      const draft = validDraft({
        evidence_quotes: [
          { alias: "E1", quote: "still doughy in the middle" },
          { alias: "E2", quote: "came out doughy again" },
        ],
        metric_category: "CORRECTION",
      });
      const r = checkProposalV4(draft, ctx);
      expectOnlyFails(r, "scope_unsupported");
    });

    it("scope_ube: Ube facts with a bake-ube target pass (the 3-letter name counts, min 3)", () => {
      const ube = makeWorld({ rows: scopeUbeRows });
      const draft = validDraft({
        section_id: "bake-ube",
        target_step_id: "bake-ube-02",
        change_text: "Bake the Ube tray for 12 minutes at 165 C and check the middle is set before boxing.",
        evidence_quotes: [
          { alias: "E1", quote: "still doughy in the middle" },
          { alias: "E2", quote: "came out doughy again" },
        ],
      });
      const r = checkProposalV4(draft, checkCtx(ube, { fetchedSections: new Set(["bake-ube"]) }));
      expect(r.passed).toBe(true);
    });

    it("passes: Dubai facts with a Dubai target (the default world)", () => {
      expect(passedOf(checkProposalV4(validDraft(), checkCtx(w)), "scope_unsupported")).toBe(true);
    });

    it("matches by prefix in either direction: distinctive `bake` vs the fact word `baked`", () => {
      const steps: SopStep[] = [
        { step_id: "bake-01", title: "Bake tray", role: "staff", text: "Bake the tray." },
        { step_id: "bake-02", title: "Bake rack", role: "staff", text: "Bake on the rack." },
        { step_id: "serve-01", title: "Serve customer", role: "staff", text: "Serve the customer." },
        { step_id: "serve-02", title: "Serve counter", role: "staff", text: "Serve at the counter." },
      ];
      const small = makeWorld({ steps });
      const draftFor = (q1: string, q2: string): ProposalDraftV4 =>
        validDraft({
          section_id: "bake",
          target_step_id: "bake-01",
          change_text: "Bake the tray after the oven is ready.",
          evidence_quotes: [
            { alias: "E1", quote: q1 },
            { alias: "E2", quote: q2 },
          ],
        });
      const hit = withEvidence(small, [
        { summary: "Cookies were baked too early.", excerpt: "oven not ready" },
        { summary: "Cookies were baked too early again.", excerpt: "oven not ready again" },
      ]);
      const ok = checkProposalV4(draftFor("oven not ready", "oven not ready again"), {
        ...hit,
        fetchedSections: new Set(["bake"]),
      });
      expect(passedOf(ok, "scope_unsupported")).toBe(true);
      // a fact that says nothing about baking, trays or racks does not support a bake-section change
      const miss = withEvidence(small, [
        { summary: "Customers waited at the till.", excerpt: "long queue today" },
        { summary: "Customers waited at the till again.", excerpt: "long queue again" },
      ]);
      const bad = checkProposalV4(draftFor("long queue today", "long queue again"), {
        ...miss,
        fetchedSections: new Set(["bake"]),
      });
      expect(passedOf(bad, "scope_unsupported")).toBe(false);
    });

    it("is skipped on a one-section SOP (the demo SOP collapses to `all`)", () => {
      const demo = makeWorld({ steps: DEMO_SOP_V1.steps });
      expect(demo.sections).toHaveLength(1);
      const r = checkProposalV4(
        validDraft({
          section_id: "all",
          target_step_id: "bake-01",
          change_text: "Bake the tray, check the oven is back at temperature first, then log the bake time.",
        }),
        checkCtx(demo, { fetchedSections: new Set(["all"]) }),
      );
      expect(passedOf(r, "scope_unsupported")).toBe(true);
    });

    it("passes when the target section has no distinctive token (nothing to test)", () => {
      const steps: SopStep[] = [
        { step_id: "ab-01", title: "Prep rinse", role: "staff", text: "Prep and rinse the trays before the first batch." },
        { step_id: "ab-02", title: "Rinse tray", role: "staff", text: "Rinse the tray." },
        { step_id: "cd-01", title: "Prep rinse", role: "staff", text: "Prep the second line." },
        { step_id: "cd-02", title: "Rinse tray", role: "staff", text: "Rinse the second tray." },
      ];
      const small = makeWorld({ steps });
      expect(small.sections.map((s) => s.section_id)).toEqual(["ab", "cd"]);
      const r = checkProposalV4(
        validDraft({ section_id: "ab", target_step_id: "ab-01", change_text: "Prep and rinse trays, then dry them." }),
        checkCtx(small, { fetchedSections: new Set(["ab"]) }),
      );
      expect(passedOf(r, "scope_unsupported")).toBe(true);
    });

    it("a stop word that is the only unique title token is not distinctive (`and`) -> passes", () => {
      const steps: SopStep[] = [
        { step_id: "ab-01", title: "Prep and rinse", role: "staff", text: "Prep and rinse the trays." },
        { step_id: "ab-02", title: "Rinse tray", role: "staff", text: "Rinse the tray." },
        { step_id: "cd-01", title: "Prep rinse", role: "staff", text: "Prep the second line." },
        { step_id: "cd-02", title: "Rinse tray", role: "staff", text: "Rinse the second tray." },
      ];
      const small = makeWorld({ steps });
      const r = checkProposalV4(
        validDraft({ section_id: "ab", target_step_id: "ab-01", change_text: "Prep and rinse trays, then dry them." }),
        checkCtx(small, { fetchedSections: new Set(["ab"]) }),
      );
      expect(passedOf(r, "scope_unsupported")).toBe(true);
    });

    it("a 3-letter section name that is the only distinctive token: passes when the evidence has it, fails when not", () => {
      const steps: SopStep[] = [
        { step_id: "bun-01", title: "Mix", role: "staff", text: "Mix the dough." },
        { step_id: "bun-02", title: "Proof", role: "staff", text: "Proof the dough." },
        { step_id: "roll-01", title: "Mix", role: "staff", text: "Mix the other dough." },
        { step_id: "roll-02", title: "Proof", role: "staff", text: "Proof the other dough." },
      ];
      const small = makeWorld({ steps });
      expect(small.sections.map((s) => s.section_id)).toEqual(["bun", "roll"]);
      const draftFor = (q1: string, q2: string): ProposalDraftV4 =>
        validDraft({
          section_id: "bun",
          target_step_id: "bun-02",
          change_text: "Proof the dough for 40 minutes under a cloth.",
          evidence_quotes: [
            { alias: "E1", quote: q1 },
            { alias: "E2", quote: q2 },
          ],
        });
      const has = withEvidence(small, [
        { summary: "The bun dough was under-proofed.", excerpt: "bun dough was dense" },
        { summary: "The bun dough was under-proofed again.", excerpt: "bun dough was dense again" },
      ]);
      const ok = checkProposalV4(draftFor("bun dough was dense", "bun dough was dense again"), {
        ...has,
        fetchedSections: new Set(["bun"]),
      });
      expect(passedOf(ok, "scope_unsupported")).toBe(true);

      const lacks = withEvidence(small, [
        { summary: "The dough was under-proofed.", excerpt: "dough was dense" },
        { summary: "The dough was under-proofed again.", excerpt: "dough was dense again" },
      ]);
      const bad = checkProposalV4(draftFor("dough was dense", "dough was dense again"), {
        ...lacks,
        fetchedSections: new Set(["bun"]),
      });
      expect(passedOf(bad, "scope_unsupported")).toBe(false);
    });

    it("the evidence side ignores stop words and words under 3 chars", () => {
      // distinctive tokens of bake-dubai include `dubai`, `chewy`, `rest`, `label`; the facts only have `du`, `the`, `all`.
      const ctx = withEvidence(w, [
        { summary: "Du the all tray flat.", excerpt: "du the all" },
        { summary: "Du the all tray flat again.", excerpt: "du the all again" },
      ]);
      const draft = validDraft({
        evidence_quotes: [
          { alias: "E1", quote: "du the all tray flat" },
          { alias: "E2", quote: "du the all tray flat again" },
        ],
      });
      expect(passedOf(checkProposalV4(draft, ctx), "scope_unsupported")).toBe(false);
    });

    it("mixed_one_wrong: the Dubai target with a mixed Ube-and-Dubai fact still passes (Dubai is mentioned)", () => {
      const mixed = makeWorld({ rows: scopeMixedRows });
      const draft = validDraft({
        evidence: ["E1", "E2"],
        evidence_quotes: [
          { alias: "E1", quote: "Dubai chewy batch came out flat and dark" },
          { alias: "E2", quote: "Dubai chewy came out flat and dark again" },
        ],
      });
      expect(passedOf(checkProposalV4(draft, checkCtx(mixed)), "scope_unsupported")).toBe(true);
    });
  });

  describe("change_is_noop", () => {
    const current = "Bake the Dubai Chewy tray for 14 minutes at 170 C.";
    it("fires when a modify equals the step's current text, or differs only by whitespace/case/punctuation", () => {
      expectOnlyFails(checkProposalV4(validDraft({ change_text: current }), checkCtx(w)), "change_is_noop");
      expectOnlyFails(
        checkProposalV4(validDraft({ change_text: `  bake the DUBAI Chewy tray\nfor 14   minutes at 170 C ` }), checkCtx(w)),
        "change_is_noop",
      );
    });
    it("fires when a NEW step repeats an existing step's text", () => {
      const r = checkProposalV4(
        validDraft({ target_step_id: "NEW", change_text: "Greet, take the order, confirm it back, take payment." }),
        checkCtx(w),
      );
      expect(passedOf(r, "change_is_noop")).toBe(false);
    });
    it("does not fire for a real change, or a NEW step with new text", () => {
      expect(passedOf(checkProposalV4(validDraft(), checkCtx(w)), "change_is_noop")).toBe(true);
      const created = checkProposalV4(
        validDraft({ target_step_id: "NEW", change_text: "Check the oven is back at temperature before loading." }),
        checkCtx(w),
      );
      expect(passedOf(created, "change_is_noop")).toBe(true);
    });
  });

  describe("text_rule_violation", () => {
    it("fires on a role tag in change_text, naming the field and label", () => {
      const r = checkProposalV4(validDraft({ change_text: "[staff] Bake the tray after the oven is ready." }), checkCtx(w));
      expectOnlyFails(r, "text_rule_violation");
      expect(r.reasons).toEqual(["text_rule_violation:change_text:[staff]"]);
    });
    it("fires on an ISO date in failure_condition and in metric_description", () => {
      const r = checkProposalV4(
        validDraft({
          failure_condition: "Still flat on 2026-10-20 or later.",
          metric_description: "Count since 2026-10-13.",
        }),
        checkCtx(w),
      );
      expect(r.reasons).toEqual([
        "text_rule_violation:metric_description:ISO date",
        "text_rule_violation:failure_condition:ISO date",
      ]);
      expect(r.fired_rule).toBe("text_rule_violation");
    });
    it("a label containing a colon is kept whole", () => {
      const r = checkProposalV4(validDraft({ rationale: "Staff (role: staff) skipped it." }), checkCtx(w));
      expect(r.reasons).toEqual(["text_rule_violation:rationale:(role:"]);
    });
    it("does not fire on clean text", () => {
      expect(passedOf(checkProposalV4(validDraft(), checkCtx(w)), "text_rule_violation")).toBe(true);
    });
  });

  describe("pgate-v1 precedence and reasons", () => {
    it("evidence_min (pgate-v1) fires before any v4 rule, even when a v4 rule also fails", () => {
      const r = checkProposalV4(
        validDraft({ evidence: ["E1"], evidence_quotes: [{ alias: "E1", quote: "came out flat and dark" }] }),
        checkCtx(w, { fetchedSections: new Set() }),
      );
      expect(r.fired_rule).toBe("evidence_min");
      expect(r.checks.slice(0, 8).map((c) => c.rule)[4]).toBe("evidence_min");
      expect(passedOf(r, "section_not_fetched")).toBe(false);
      expect(passedOf(r, "quotes_insufficient")).toBe(false);
    });

    it("reasons lists every failed rule, gate rules first then v4 rules in order; checks stays 18 long", () => {
      const r = checkProposalV4(
        validDraft({ change_text: "Bake the Dubai Chewy tray for 14 minutes at 170 C." }),
        checkCtx(w, { fetchedSections: new Set(), inspectedInterventions: new Set() }),
      );
      expect(r.checks).toHaveLength(18);
      expect(r.reasons).toEqual(["section_not_fetched", "intervention_not_inspected", "change_is_noop"]);
      expect(r.fired_rule).toBe("section_not_fetched");
    });

    it("reasons never carry draft or evidence text", () => {
      const r = checkProposalV4(
        validDraft({ change_text: "[staff] Bake the Dubai Chewy tray after the oven is ready." }),
        checkCtx(w),
      );
      for (const reason of r.reasons) expect(reason).toMatch(/^[a-z_]+(:[a-z_]+:[^:]{1,20}|)$/);
    });
  });
});

describe("normalizeForCheck", () => {
  it("folds case, quotes, punctuation and whitespace", () => {
    expect(normalizeForCheck('  Say "Hi",\n it\'s  OK! ')).toBe("say 'hi' it's ok");
  });
  it("folds compatibility forms (NFKC)", () => {
    expect(normalizeForCheck("ＡＢＣ")).toBe("abc");
  });
});
