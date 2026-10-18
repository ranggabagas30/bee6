import type { Proposal, SopVersion } from "@/lib/firestore/schema";

/**
 * Step-level re-base rule (demo feedback 2, item 20). Plain code, not AI (hard rule 10).
 *
 * "SOP_CHANGED" iff the version this proposal was drafted on is not the latest AND the step it rewrites no longer
 * reads as it did when drafted (text, title or role differ, or the step is gone), or any input needed to prove it
 * is missing. A new-step proposal never conflicts. Fail closed: null inputs are a conflict.
 *
 * Content-based, not chain-walking: only the drafted and the current doc are needed. This is equivalent to "no
 * intermediate change touched this step" because a `modify` always changes `text` (the gate refuses a no-op).
 */
export function sopConflict(input: {
  proposal: Proposal;
  drafted: SopVersion | null;
  current: SopVersion | null;
}): "ok" | "SOP_CHANGED" {
  const { proposal: p, drafted, current } = input;
  if (current === null || p.content === null) return "SOP_CHANGED";
  if (current.sop_version_id === p.generator.sop_version_id) return "ok";
  if (drafted === null || drafted.outlet_id !== current.outlet_id || drafted.version >= current.version) {
    return "SOP_CHANGED";
  }
  const id = p.content.target_step_id;
  if (id === null) return "ok"; // an added step cannot collide (its id is p-<uuid>)
  const was = drafted.steps.find((s) => s.step_id === id);
  const now = current.steps.find((s) => s.step_id === id);
  if (!was || !now) return "SOP_CHANGED";
  return was.text === now.text && was.title === now.title && was.role === now.role ? "ok" : "SOP_CHANGED";
}
