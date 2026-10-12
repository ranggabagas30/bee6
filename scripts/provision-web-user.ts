/**
 * Admin-only provisioning for owner/supervisor Firebase Auth accounts (R-06
 * Task 9, web spec §3, CLAUDE.md §0 item 1). Run by Rangga or dev-ops, never
 * by the app: it is the "password reset" story for the pilot and the demo
 * ("re-run with --reset-password").
 *
 *   npm run provision:web-user -- --project <pilot|demo> --email <email> [--reset-password]
 *
 * There is deliberately no `--password` flag: a password on the command line
 * lands in shell history. A random password is generated and printed exactly
 * once; it is never written to a file or logged again.
 *
 * The role and outlet come only from the already-seeded `users` doc — this
 * script never takes them as arguments and never writes Firestore. It only
 * ever touches Firebase Auth.
 */
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { assertProjectMatchesEnv, type ProjectKind } from "@/scripts/seed";
import { UserSchema, parseOutletDoc, type User } from "@/lib/firestore/schema";
import { isReservedDemoEmail } from "@/lib/demo/credentials";

const USAGE =
  "Usage: npm run provision:web-user -- --project <pilot|demo> --email <email> [--reset-password]";

function usageError(): Error {
  return new Error(USAGE);
}

// ── pure: argument parsing ───────────────────────────────────────────────────
export interface ProvisionArgs {
  project: ProjectKind;
  email: string;
  reset: boolean;
}

const EmailSchema = z.email();

/**
 * Parses the script's CLI arguments. Strict: any flag other than --project,
 * --email and --reset-password (in particular, no --password) is a usage
 * error. A reserved demo address (`*.judge@example.com`) is refused outright. The email is lower-cased so it matches the seeded `users` doc the
 * same way `linkGoogleUser` does.
 */
export function parseProvisionArgs(argv: readonly string[]): ProvisionArgs {
  let project: string | undefined;
  let email: string | undefined;
  let reset = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--project":
        project = argv[i + 1];
        i += 1;
        break;
      case "--email":
        email = argv[i + 1];
        i += 1;
        break;
      case "--reset-password":
        reset = true;
        break;
      default:
        throw usageError();
    }
  }

  if (project !== "pilot" && project !== "demo") throw usageError();
  if (!email) throw usageError();
  const parsedEmail = EmailSchema.safeParse(email);
  if (!parsedEmail.success) throw usageError();
  // R-18 P1: the published demo sign-in emails must never become real accounts, on any project. Checked here, before any I/O.
  if (isReservedDemoEmail(parsedEmail.data)) throw new Error("reserved demo address");

  return { project, email: parsedEmail.data.toLowerCase(), reset };
}

// ── pure: the provisioning decision ──────────────────────────────────────────
export interface UserDocLike {
  outlet_id: string;
  uid: string | null;
  email: string;
  role: User["role"];
}

export interface OutletLike {
  outlet_id: string;
  project_kind: "pilot" | "demo";
}

export type ProvisionRefusalReason =
  | "no_user_doc"
  | "duplicate_user_doc"
  | "wrong_project"
  | "exists_without_reset";

export type ProvisionPlan =
  | { kind: "create" }
  | { kind: "reset"; uid: string }
  | { kind: "refuse"; reason: ProvisionRefusalReason };

export interface PlanProvisionInput {
  userDocs: readonly UserDocLike[];
  outlet: OutletLike | null;
  project: ProjectKind;
  authUser: { uid: string } | null;
  reset: boolean;
}

/**
 * The provisioning decision, pure and Firestore/Firebase-free so it is fully
 * unit-tested. The role and outlet always come from `userDocs[0]` (the single
 * matching `users` doc); the caller never supplies them directly.
 */
export function planProvision(input: PlanProvisionInput): ProvisionPlan {
  if (input.userDocs.length === 0) return { kind: "refuse", reason: "no_user_doc" };
  if (input.userDocs.length >= 2) return { kind: "refuse", reason: "duplicate_user_doc" };
  if (!input.outlet || input.outlet.project_kind !== input.project) {
    return { kind: "refuse", reason: "wrong_project" };
  }
  if (!input.authUser) return { kind: "create" };
  if (!input.reset) return { kind: "refuse", reason: "exists_without_reset" };
  return { kind: "reset", uid: input.authUser.uid };
}

const REFUSAL_MESSAGES: Record<ProvisionRefusalReason, string> = {
  no_user_doc: "No users doc found for this email. Seed the user first: `npm run seed`.",
  duplicate_user_doc: "More than one users doc matches this email (data error).",
  wrong_project:
    "The seeded outlet's project_kind does not match --project. Pilot and demo " +
    "live in different GCP projects and must never mix.",
  exists_without_reset:
    "An account already exists for this email. Re-run with --reset-password " +
    "to set a new password.",
};

// ── pure: password generation ────────────────────────────────────────────────
/** 24 characters, URL-safe base64 — generated only on the create/reset paths. */
export function generatePassword(): string {
  return randomBytes(18).toString("base64url");
}

// ── IO: Firestore + Firebase Auth wiring ─────────────────────────────────────
async function findUserDocs(email: string): Promise<User[]> {
  const snap = await adminDb()
    .collection(COLLECTIONS.users)
    .where("email", "==", email)
    .limit(2)
    .get();
  return snap.docs.map((doc) => UserSchema.parse(doc.data()));
}

async function readOutlet(outletId: string): Promise<OutletLike> {
  const doc = await adminDb().collection(COLLECTIONS.outlets).doc(outletId).get();
  if (!doc.exists) {
    throw new Error(`Outlet not found: ${outletId}`);
  }
  const outlet = parseOutletDoc(doc.data());
  return { outlet_id: outlet.outlet_id, project_kind: outlet.project_kind };
}

function isFirebaseAuthErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

async function findAuthUser(email: string): Promise<{ uid: string } | null> {
  try {
    const user = await adminAuth().getUserByEmail(email);
    return { uid: user.uid };
  } catch (error) {
    if (isFirebaseAuthErrorCode(error, "auth/user-not-found")) return null;
    throw error;
  }
}

async function main(): Promise<void> {
  const args = parseProvisionArgs(process.argv.slice(2));
  assertProjectMatchesEnv(args.project);

  const userDocs = await findUserDocs(args.email);
  const singleUserDoc = userDocs.length === 1 ? userDocs[0] : undefined;
  const outlet = singleUserDoc ? await readOutlet(singleUserDoc.outlet_id) : null;
  const authUser = await findAuthUser(args.email);

  const plan = planProvision({
    userDocs,
    outlet,
    project: args.project,
    authUser,
    reset: args.reset,
  });

  if (plan.kind === "refuse" || !singleUserDoc) {
    const reason = plan.kind === "refuse" ? plan.reason : "no_user_doc";
    console.error(`[provision] refused: ${REFUSAL_MESSAGES[reason]}`);
    process.exitCode = 1;
    return;
  }

  const user = singleUserDoc;
  const password = generatePassword();

  if (plan.kind === "create") {
    await adminAuth().createUser({
      email: args.email,
      password,
      emailVerified: true,
      disabled: false,
    });
  } else {
    await adminAuth().updateUser(plan.uid, {
      password,
      emailVerified: true,
      disabled: false,
    });
    await adminAuth().revokeRefreshTokens(plan.uid);
  }

  // Claims are NOT set here — the first sign-in's POST /api/v1/auth/session
  // sets them from the users doc (lib/auth/services.ts linkGoogleUser).
  console.log(
    `[provision] ${args.email} (${user.role}, ${user.outlet_id}) password, shown once: ${password}`,
  );
}

const isMainModule =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main().catch((error) => {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code)
        : error instanceof Error
          ? error.message
          : String(error);
    console.error("[provision] failed:", code);
    process.exitCode = 1;
  });
}
