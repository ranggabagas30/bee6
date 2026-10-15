import type { Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { adminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { firestoreDayStore } from "@/lib/firestore/day-store";
import { firestoreSopStore } from "@/lib/firestore/sop-store";
import { OWNER_DECISIONS, PROPOSAL_STATUSES, SUPERVISOR_DECISIONS } from "@/lib/firestore/schema";
import type { HomeStore } from "@/lib/home/service";
import type { HomeProposalRow, HomeSopVersionRow } from "@/lib/home/progress";

/**
 * Firestore-backed `HomeStore` (R-19 PR-8, plan 9.2). The day-record half delegates to `firestoreDayStore` (the
 * read methods only: the owner Home never confirms a thread, so `transactConfirm` is not exposed). The three PR-8
 * reads are outlet-scoped and field-masked to the decisions, the title and the timestamps the tallies need: no
 * rejection reason, constraint id, evidence or change text is ever read here (hard rules #3 and #7). Malformed or
 * foreign-outlet docs are skipped and logged `{ doc_id, error_class }` only, like every other store.
 */

export const HOME_DECIDED_MAX = 500;
export const HOME_AWAITING_MAX = 50;

const DECIDED_STATUSES = ["approved", "rejected"] as const;

/** Exactly the fields the Home needs; dotted paths so Firestore returns nothing else of the decision slots. */
const PROPOSAL_FIELDS = [
  "outlet_id",
  "proposal_id",
  "status",
  "supervisor_review.decision",
  "owner_decision.decision",
  "owner_decision.decided_at_ms",
  "content.change_title",
  "updated_at_ms",
] as const;

// Not strict: a field-masked read returns partial objects (and `null` parents come back absent).
const PROPOSAL_ROW_SHAPE = z.object({
  outlet_id: z.string().min(1),
  proposal_id: z.string().uuid(),
  status: z.enum(PROPOSAL_STATUSES),
  supervisor_review: z.object({ decision: z.enum(SUPERVISOR_DECISIONS) }).nullable().optional(),
  owner_decision: z.object({ decision: z.enum(OWNER_DECISIONS), decided_at_ms: z.number().int().min(0) }).nullable().optional(),
  content: z.object({ change_title: z.string().min(1) }).nullable().optional(),
  updated_at_ms: z.number().int().min(0),
});

function logSkippedDoc(context: string, docId: string): void {
  console.error(`[home-store] skipping malformed ${context} doc`, { doc_id: docId, error_class: "ZodError" });
}

function toRow(parsed: z.infer<typeof PROPOSAL_ROW_SHAPE>): HomeProposalRow {
  const od = parsed.owner_decision ?? null;
  return {
    proposal_id: parsed.proposal_id,
    status: parsed.status,
    supervisor_decision: parsed.supervisor_review?.decision ?? null,
    owner_decision: od === null ? null : { decision: od.decision, decided_at_ms: od.decided_at_ms },
    change_title: parsed.content?.change_title ?? null,
    updated_at_ms: parsed.updated_at_ms,
  };
}

export function firestoreHomeStore(outletId: string, db: Firestore = adminDb()): HomeStore {
  const day = firestoreDayStore(outletId, db);
  const sop = firestoreSopStore(outletId, db);

  async function readProposals(
    apply: (q: FirebaseFirestore.Query) => FirebaseFirestore.Query,
    limit: number,
    keep: (status: HomeProposalRow["status"]) => boolean,
  ): Promise<HomeProposalRow[]> {
    const snap = await apply(db.collection(COLLECTIONS.proposals).where("outlet_id", "==", outletId))
      .limit(limit)
      .select(...PROPOSAL_FIELDS)
      .get();
    const out: HomeProposalRow[] = [];
    for (const doc of snap.docs) {
      const result = PROPOSAL_ROW_SHAPE.safeParse(doc.data());
      if (!result.success) {
        logSkippedDoc("proposal", doc.id);
        continue;
      }
      if (result.data.outlet_id !== outletId) continue;
      if (!keep(result.data.status)) continue;
      out.push(toRow(result.data));
    }
    return out;
  }

  return {
    getOutlet: () => day.getOutlet(),
    listSessions: (dates) => day.listSessions(dates),
    listThreads: (fromMs, toMs, opts) => day.listThreads(fromMs, toMs, opts),
    getQuestions: (ids) => day.getQuestions(ids),
    getCorrections: (ids) => day.getCorrections(ids),
    listUnlabelledQuestions: (fromMs, toMs, limit) => day.listUnlabelledQuestions(fromMs, toMs, limit),
    countPairedDevices: () => day.countPairedDevices(),
    listAnsweredGateQuestions: (sinceMs, limit) => day.listAnsweredGateQuestions(sinceMs, limit),
    getThreads: (ids) => day.getThreads(ids),

    listDecidedProposals() {
      return readProposals(
        (q) => q.where("status", "in", [...DECIDED_STATUSES]),
        HOME_DECIDED_MAX,
        (status) => status === "approved" || status === "rejected",
      );
    },

    listAwaitingOwnerProposals() {
      return readProposals(
        (q) => q.where("status", "==", "awaiting_owner"),
        HOME_AWAITING_MAX,
        (status) => status === "awaiting_owner",
      );
    },

    async listSopVersions(): Promise<HomeSopVersionRow[]> {
      const versions = await sop.listVersions();
      return versions.map((v) => {
        const change = v.change ?? null;
        return change === null
          ? { review_date: null, change_title: null }
          : { review_date: change.review_date, change_title: change.change_title };
      });
    },
  };
}
