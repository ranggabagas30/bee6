import type { NextRequest } from "next/server";
import { UnauthorizedError, handleApiError } from "@/lib/http/errors";
import { jsonOk } from "@/lib/http/respond";
import { extractBearerToken } from "@/lib/http/guard";
import { verifyIdToken, setUserClaims } from "@/lib/firebase/admin";
import { linkGoogleUser } from "@/lib/auth/services";
import { firestoreUserStore } from "@/lib/firestore/stores";

/**
 * POST /api/v1/auth/session (web spec §3).
 * Owner/supervisor Google sign-in. The client signs in with Google via Firebase,
 * then posts its Firebase ID token here. We verify it, match the verified email
 * to a seeded `users` doc, and set custom claims `{ outlet_id, role }`. The
 * client must refresh its ID token afterwards to pick up the new claims.
 *
 * (Enabling the Google provider in each Firebase project's console is a
 * Rangga-only step; without it there is no ID token to post.)
 */

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const idToken = extractBearerToken(req);
    const { uid, email } = await verifyIdToken(idToken);
    if (!email) {
      throw new UnauthorizedError("Google account has no verified email");
    }

    const result = await linkGoogleUser(
      { users: firestoreUserStore(), setClaims: setUserClaims },
      { uid, email },
    );

    return jsonOk({ outlet_id: result.outlet_id, role: result.role });
  } catch (error) {
    return handleApiError(error);
  }
}
