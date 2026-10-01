import { z } from "zod";

/**
 * Evidence gate configuration (plain code per hard rule #10).
 * Defines work categories, supervisor-confirm rules, always-question rules,
 * grace periods for thread merging, and confidence thresholds for facts.
 */

export const CATEGORIES = [
  "ROUTINE_OPS",
  "CUSTOMER_SERVICE",
  "TRAINING",
  "STAFF_CONSULT",
  "CORRECTION",
  "PHONE_CALL",
  "EVENT",
  "COMPLAINT",
  "SAFETY_INCIDENT",
  "SECURITY_INCIDENT",
  "DISRUPTION",
  "NON_WORK",
] as const;

export const CategorySchema = z.enum(CATEGORIES);
export type Category = z.infer<typeof CategorySchema>;
export type WorkCategory = Exclude<Category, "NON_WORK">;

/**
 * Categories that always require supervisor confirmation before becoming facts,
 * regardless of confidence. Per the plan:
 * COMPLAINT, CORRECTION, SAFETY_INCIDENT, SECURITY_INCIDENT, DISRUPTION.
 */
export const NEEDS_SUPERVISOR_CONFIRM: ReadonlySet<WorkCategory> = new Set([
  "COMPLAINT",
  "CORRECTION",
  "SAFETY_INCIDENT",
  "SECURITY_INCIDENT",
  "DISRUPTION",
]);

/**
 * PHONE_CALL is always a question, never an auto-fact, regardless of confidence.
 * Per hard rule #10 and product spec §5.
 */
export const ALWAYS_QUESTION: ReadonlySet<WorkCategory> = new Set([
  "PHONE_CALL",
]);

/**
 * Grace periods for thread merging (in milliseconds).
 * Determine how long after a thread's last line a new line can be added without
 * creating a new thread.
 *
 * Grouping (per the plan's "Open for Rangga" section):
 *  - SAFETY_INCIDENT/SECURITY_INCIDENT/DISRUPTION = 5 min (incidental categories
 *    that require supervisor confirm regardless, so merge is safe)
 *  - TRAINING = 10 min (spec'd separately)
 *  - ROUTINE_OPS/CUSTOMER_SERVICE/STAFF_CONSULT/CORRECTION/PHONE_CALL/EVENT = 2 min
 *    (everything else; conservative for fact-path categories)
 */
export const GRACE_MS: Readonly<Record<WorkCategory, number>> = {
  ROUTINE_OPS: 120_000, // 2 min
  CUSTOMER_SERVICE: 120_000, // 2 min
  STAFF_CONSULT: 120_000, // 2 min
  CORRECTION: 120_000, // 2 min
  PHONE_CALL: 120_000, // 2 min
  EVENT: 120_000, // 2 min
  COMPLAINT: 300_000, // 5 min
  SAFETY_INCIDENT: 300_000, // 5 min
  SECURITY_INCIDENT: 300_000, // 5 min
  DISRUPTION: 300_000, // 5 min
  TRAINING: 600_000, // 10 min
};

/**
 * Confidence threshold for each category to become a fact.
 * Currently all 0.9 (uncalibrated). Per the plan, these are not yet tuned
 * to real model outputs.
 */
export const FACT_THRESHOLD: Readonly<Record<WorkCategory, number>> = {
  ROUTINE_OPS: 0.9,
  CUSTOMER_SERVICE: 0.9,
  TRAINING: 0.9,
  STAFF_CONSULT: 0.9,
  CORRECTION: 0.9,
  PHONE_CALL: 0.9,
  EVENT: 0.9,
  COMPLAINT: 0.9,
  SAFETY_INCIDENT: 0.9,
  SECURITY_INCIDENT: 0.9,
  DISRUPTION: 0.9,
};
