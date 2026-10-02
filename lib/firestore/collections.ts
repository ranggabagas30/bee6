/**
 * Firestore collection names (web spec §6.4). One source of truth so routes,
 * the seed script and stores never type a collection name by hand.
 *
 * Every document in every collection carries `outlet_id`; the server RBAC guard
 * (lib/auth/rbac.ts) rejects any read or write outside the caller's outlet.
 */

export const COLLECTIONS = {
  outlets: "outlets",
  users: "users",
  staff: "staff",
  devices: "devices",
  /** Subcollection of a device: devices/{device_id}/heartbeats/{ts}. */
  heartbeats: "heartbeats",
  segments: "segments",
  windows: "windows",
  threads: "threads",
  questions: "questions",
  /** Per-line ledger (R-05b Task 5) — which LabelUnit lines are labelled. */
  labelUnits: "label_units",
  /** Single-flight tick lease per device (R-05b Task 6). */
  pipelineLocks: "pipeline_locks",
  corrections: "corrections",
  sopVersions: "sop_versions",
  proposals: "proposals",
  constraints: "constraints",
  reviews: "reviews",
  outcomes: "outcomes",
  salesEvents: "sales_events",
  eventCards: "event_cards",
  auditLog: "audit_log",
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];
