import { NextResponse, type NextRequest } from "next/server";
import { mintCustomToken } from "@/lib/firebase/admin";
import { BadRequestError, PayloadTooLargeError, ValidationError, handleApiError } from "@/lib/http/errors";
import { jsonOk } from "@/lib/http/respond";
import { firestoreDemoStore } from "@/lib/firestore/demo-store";
import { DemoSessionBodySchema } from "@/lib/demo/contract";
import { clientIp } from "@/lib/demo/limits";
import { capFromEnv, issueDemoSession } from "@/lib/demo/service";
import { SANDBOX_DAILY } from "@/lib/demo/constants";

/**
 * POST /api/v1/demo/session (R-12 Task 6.4; web spec 6.2 "Anyone (demo only)"). The judge's sign-in:
 * the route is the credential, so it has no auth. DEMO ONLY. When DEMO_MODE is not exactly "true"
 * (read per request) every request, any method, any body, gets the same 404 as the first thing the
 * route does (the same pattern as POST /api/v1/reviews/fast-forward), so nothing a caller sends can
 * tell the pilot this route exists.
 *
 * Abuse limits (all plain code in lib/demo/service.ts): per-IP and daily sandbox caps, role-switch
 * cap, a body-size bound here. The client IP is hashed with DEMO_IP_SALT and the UTC day, never
 * stored or logged. DEMO_XFF_FROM_END (optional positive integer) picks the Nth x-forwarded-for
 * entry from the end instead of the first, for when the deployed proxy appends rather than replaces.
 * Every response is `Cache-Control: private, no-store`; tokens and the sandbox key are returned once
 * in the body and never logged.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The body is {role, sandbox_key?} (< 100 bytes); anything near this is not a client of ours. */
const BODY_MAX_CHARS = 1024;

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

function xffFromEnd(): number | undefined {
  const raw = process.env.DEMO_XFF_FROM_END;
  return raw !== undefined && /^[1-9]\d?$/.test(raw) ? Number(raw) : undefined;
}

export async function POST(req: NextRequest) {
  if (!demoOn()) return notFound();
  try {
    const text = await req.text();
    if (text.length > BODY_MAX_CHARS) throw new PayloadTooLargeError();
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
      { mintToken: mintCustomToken, caps: { sandboxDaily: capFromEnv(process.env.DEMO_SANDBOX_DAILY_CAP, SANDBOX_DAILY) } },
      {
        body: body.data,
        ip: clientIp(req.headers, xffFromEnd()),
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
