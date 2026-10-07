import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * POST /api/v1/auth/pin — DORMANT (R-07, Rangga 7 Oct). MVP 1 has no staff
 * sign-in; staff name + PIN sessions are post-MVP 1 (CLAUDE.md §3). This
 * route always answers 404, before any auth or body read, so it can't be
 * mistaken for a live endpoint. `lib/auth/pin.ts` and `staffPinLogin` stay
 * in place, unused, for when PIN sessions are built.
 */

export const runtime = "nodejs";

export async function POST(_req: NextRequest) {
  return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });
}
