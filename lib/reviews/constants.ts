/**
 * Thresholds and caps for the outcome review (R-11). Plain code, not AI
 * (hard rule #10): these numbers decide the suggested verdict and the
 * confirm deadline, never a model.
 */
export const REVIEW_RULE_VERSION = "rev-v1" as const;
export const MIN_DAYS_PER_WINDOW = 2;
export const CHANGE_THRESHOLD = 0.2; // +/-20% rate change
export const REVIEW_CONFIRM_DAYS = 7; // confirm window counts 7 days from the later of review_date and outlet-local run day (so a catch-up review is never born expired; R-11 §11 Q-2)
export const LIST_OPEN_MAX = 20;
export const LIST_DECIDED_MAX = 10;
export const REVIEWS_READ_MAX = 50;
export const OUTLETS_READ_MAX = 500; // R-12: demo sandboxes are outlets too (up to ~300 a day, cleaned after 26 h); they are skipped, but they still occupy the read
export const SESSIONS_IN_CHUNK = 30; // Firestore "in" limit
