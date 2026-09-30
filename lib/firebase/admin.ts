import {
  applicationDefault,
  getApps,
  initializeApp,
  type App,
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { CustomClaimsSchema, type CustomClaims } from "@/lib/auth/roles";

/**
 * Firebase Admin server init (web spec §6.5). Admin credentials come from
 * Application Default Credentials — the `web` Cloud Run service account (hard
 * rule #4: service accounts, never API keys). This module is imported only by
 * server code (routes, stores, the seed script); it must never reach the
 * browser, and it holds no secret literals.
 *
 * Lazy single-app init so Cloud Run cold starts and Next.js module reloads don't
 * double-initialise.
 */

let cachedApp: App | null = null;

function getAdminApp(): App {
  if (cachedApp) return cachedApp;
  cachedApp =
    getApps()[0] ?? initializeApp({ credential: applicationDefault() });
  return cachedApp;
}

export function adminAuth() {
  return getAuth(getAdminApp());
}

export function adminDb(): Firestore {
  return getFirestore(getAdminApp());
}

/** A verified ID token's identity plus any of our custom claims it carries. */
export interface VerifiedToken {
  uid: string;
  email: string | undefined;
  /**
   * Whether the provider has verified the email. The Google sign-in route
   * requires this to be true before linking a role — an unverified email must
   * never grant outlet access.
   */
  email_verified: boolean;
  claims: Partial<CustomClaims>;
}

/**
 * Verifies a Firebase ID token and extracts our custom claims (if the account
 * has been linked yet). The RBAC guard turns these into a full `CustomClaims`.
 * `email_verified` is surfaced (defaulting to false) so the Google sign-in path
 * can reject unverified emails.
 */
export async function verifyIdToken(idToken: string): Promise<VerifiedToken> {
  const decoded = await adminAuth().verifyIdToken(idToken);
  const parsed = CustomClaimsSchema.partial().safeParse({
    outlet_id: decoded.outlet_id,
    role: decoded.role,
    staff_id: decoded.staff_id,
    device_id: decoded.device_id,
  });
  return {
    uid: decoded.uid,
    email: decoded.email,
    email_verified: decoded.email_verified === true,
    claims: parsed.success ? parsed.data : {},
  };
}

/** Sets custom claims on an owner/supervisor uid after a verified Google sign-in. */
export async function setUserClaims(
  uid: string,
  claims: CustomClaims,
): Promise<void> {
  await adminAuth().setCustomUserClaims(uid, CustomClaimsSchema.parse(claims));
}

/** Mints a Firebase custom token for a staff PIN session, carrying the claims. */
export async function mintCustomToken(
  uid: string,
  claims: CustomClaims,
): Promise<string> {
  return adminAuth().createCustomToken(uid, CustomClaimsSchema.parse(claims));
}
