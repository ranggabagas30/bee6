import { NextResponse, type NextRequest } from "next/server";
import { mintCustomToken } from "@/lib/firebase/admin";
import { BadRequestError, ValidationError, handleApiError } from "@/lib/http/errors";
import { readBodyTextCapped, requireJsonContentType } from "@/lib/http/body";
import { jsonOk } from "@/lib/http/respond";
import { firestoreDemoStore } from "@/lib/firestore/demo-store";
import { DemoSessionBodySchema } from "@/lib/demo/contract";
import { clientIp, resolveXffFromEnd } from "@/lib/demo/limits";
import { capFromEnv, sandboxDailyLimit } from "@/lib/demo/caps";
import { issueDemoSession } from "@/lib/demo/service";
import { SWITCH_IP_DAILY } from "@/lib/demo/constants";

/**
 * POST /api/v1/demo/session (R-12 Task 6.4; web spec 6.2 "Anyone (demo only)"). The judge's sign-in:
 * the route is the credential, so it has no auth. DEMO ONLY. When DEMO_MODE is not exactly "true"
 * (read per request) every request, any method, any body, gets the same 404 as the first thing the
 * route does (the same pattern as POST /api/v1/reviews/fast-forward), so nothing a caller sends can
 * tell the pilot this route exists.
 *
 * Abuse limits (all plain code in lib/demo/service.ts): per-IP and daily sandbox caps, role-switch
 * cap, a body bound here (Content-Type application/json only; at most 1 KB, counted in bytes while
 * the stream is read, so an oversized body is never buffered). The client IP is hashed with DEMO_IP_SALT and the UTC day, never
 * stored or logged. The client IP is the LAST x-forwarded-for entry (appended by Google's front end;
 * everything before it is client-supplied). DEMO_XFF_FROM_END (optional, 1 to 10) only overrides the
 * position from the end; an invalid value fails closed to 1.
 * Every response is `Cache-Control: private, no-store`; tokens and the sandbox key are returned once
 * in the body and never logged.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The body is {role, sandbox_key?} (< 100 bytes); anything near this is not a client of ours. */
const BODY_MAX_BYTES = 1024;

const demoOn = () => process.env.DEMO_MODE === "true";

function noStore(res: NextResponse): NextResponse {
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}

function notFound(): NextResponse {
  return noStore(NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 }));
}

/** Other methods: indistinguishable from a missing route off-demo; a plain 405 in demo mode. */
function otherMethod(): NextResponse {
  if (!demoOn()) return notFound();
  return noStore(
    NextResponse.json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, { status: 405, headers: { Allow: "POST" } }),
  );
}
export const GET = otherMethod;
export const PUT = otherMethod;
export const PATCH = otherMethod;
export const DELETE = otherMethod;
export const OPTIONS = otherMethod;

export async function POST(req: NextRequest) {
  if (!demoOn()) return notFound();
  try {
    // Content-Type first (a cross-site text/plain POST never reaches the parser), then a byte-capped read.
    requireJsonContentType(req.headers);
    const text = await readBodyTextCapped(req, BODY_MAX_BYTES);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new BadRequestError("Body must be JSON");
    }
    const body = DemoSessionBodySchema.safeParse(raw);
    if (!body.success) {
      throw new ValidationError(
        "invalid_body",
        body.error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.code })),
      );
    }

    const data = await issueDemoSession(
      firestoreDemoStore(),
      {
        mintToken: mintCustomToken,
        caps: {
          sandboxDaily: sandboxDailyLimit(process.env),
          switchIpDaily: capFromEnv(process.env.DEMO_SWITCH_IP_CAP, SWITCH_IP_DAILY),
        },
      },
      {
        body: body.data,
        ip: clientIp(req.headers, resolveXffFromEnd(process.env.DEMO_XFF_FROM_END)),
        now_ms: Date.now(),
        demoMode: true,
        salt: process.env.DEMO_IP_SALT ?? "",
      },
    );
    return noStore(jsonOk(data, 200));
  } catch (error) {
    return noStore(handleApiError(error));
  }
}
