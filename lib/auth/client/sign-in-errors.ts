import type { DictKey } from "@/lib/i18n/dict";

/**
 * R-06 Task 4.5. Maps a Firebase sign-in error to the message key. One
 * message for every "the credential was wrong" case so an attacker cannot
 * tell which part failed, and so it matches Firebase's own email-enumeration
 * protection (which already collapses these to `invalid-credential`).
 */
const CODE_KEYS: Record<string, DictKey> = {
  "auth/invalid-credential": "C-signin-bad",
  "auth/wrong-password": "C-signin-bad",
  "auth/user-not-found": "C-signin-bad",
  "auth/invalid-email": "C-signin-bad",
  "auth/user-disabled": "C-signin-denied",
  "auth/too-many-requests": "C-signin-many",
  "auth/network-request-failed": "C-signin-net",
  "auth/operation-not-allowed": "C-signin-config",
};

export function signInErrorKey(err: unknown): DictKey {
  if (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as { code?: unknown }).code === "string"
  ) {
    return CODE_KEYS[(err as { code: string }).code] ?? "C-srv-generic";
  }
  return "C-srv-generic";
}
