/**
 * Seed script (R-02, web spec §2, §3, §6.4). Creates an outlet, its owner +
 * supervisor sign-in emails, staff (name + PIN hash), and a paired-pending shop
 * device with a 6-digit pairing code (valid 10 min), then prints the code.
 *
 *   npm run seed -- --project demo    # built-in FICTIONAL data
 *   npm run seed -- --project pilot   # reads private/seed.pilot.json (untracked)
 *
 * Hard rules honoured:
 *  - Pilot and demo live in DIFFERENT GCP projects and must never mix. The
 *    script refuses to run unless DEMO_MODE matches the --project choice.
 *  - No real Proofed data in the repo (#8): pilot data comes from an untracked
 *    file under /private/; only the demo data is literal, and it is fictional.
 *  - PINs are hashed (never stored/printed in the clear); staff names live only
 *    in the `staff` collection (#7).
 *  - Firestore access is server-side via the Admin SDK (ADC / service account, #4).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { adminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  DeviceSchema,
  OutletSchema,
  StaffSchema,
  UserSchema,
  type Device,
  type Outlet,
  type Staff,
  type User,
} from "@/lib/firestore/schema";
import { hashPin } from "@/lib/auth/pin";
import { generatePairingCode, pairingCodeExpiry } from "@/lib/auth/pairing";

// ── seed config shape ────────────────────────────────────────────────────────
export const SeedConfigSchema = z
  .object({
    outlet: z
      .object({
        outlet_id: z.string().min(1),
        name: z.string().min(1),
        timezone: z.string().min(1),
        opening_time: z.string().regex(/^\d{2}:\d{2}$/),
        closing_time: z.string().regex(/^\d{2}:\d{2}$/),
        consent_complete: z.boolean(),
      })
      .strict(),
    owner: z.object({ email: z.email() }).strict(),
    supervisors: z.array(z.object({ email: z.email() }).strict()),
    staff: z
      .array(
        z
          .object({
            staff_id: z.string().min(1),
            name: z.string().min(1),
            role: z.enum(["owner", "supervisor", "staff"]),
            pin: z.string().regex(/^\d{4}$/),
          })
          .strict(),
      )
      .min(1),
    device: z
      .object({ device_id: z.string().min(1), label: z.string().min(1) })
      .strict(),
  })
  .strict();
export type SeedConfig = z.infer<typeof SeedConfigSchema>;

export type ProjectKind = "pilot" | "demo";

/** Built-in FICTIONAL demo data — never real Proofed data (hard rule #8). */
export const DEMO_SEED: SeedConfig = {
  outlet: {
    outlet_id: "demo-outlet",
    name: "Demo Bakehouse",
    timezone: "Asia/Jakarta",
    opening_time: "07:00",
    closing_time: "21:45",
    consent_complete: true,
  },
  owner: { email: "demo-owner@example.com" },
  supervisors: [{ email: "demo-supervisor@example.com" }],
  staff: [
    { staff_id: "demo-staff-1", name: "Ari Demo", role: "staff", pin: "1111" },
    { staff_id: "demo-staff-2", name: "Bella Demo", role: "staff", pin: "2222" },
  ],
  device: { device_id: "demo-phone", label: "Demo shop phone" },
};

// ── document builder (pure; unit-tested) ─────────────────────────────────────
export interface SeedDocuments {
  outlet: Outlet;
  users: User[];
  staff: Staff[];
  device: Device;
  pairingCode: string;
}

/**
 * Turns a validated config into the Firestore documents to write, validating
 * each against its schema. PINs are hashed here; the plaintext never leaves this
 * function. The 6-digit pairing code is returned so `main` can print it.
 */
export async function buildSeedDocuments(
  config: SeedConfig,
  project: ProjectKind,
  opts: {
    pairingCode: string;
    now: Date;
    hash?: (pin: string) => Promise<string>;
  },
): Promise<SeedDocuments> {
  const nowIso = opts.now.toISOString();
  const hash = opts.hash ?? hashPin;

  const outlet: Outlet = OutletSchema.parse({
    outlet_id: config.outlet.outlet_id,
    name: config.outlet.name,
    project_kind: project,
    consent_complete: config.outlet.consent_complete,
    timezone: config.outlet.timezone,
    opening_time: config.outlet.opening_time,
    closing_time: config.outlet.closing_time,
    created_at: nowIso,
  });

  const users: User[] = [
    UserSchema.parse({
      outlet_id: outlet.outlet_id,
      uid: null,
      email: config.owner.email.toLowerCase(),
      role: "owner",
      created_at: nowIso,
    }),
    ...config.supervisors.map((s) =>
      UserSchema.parse({
        outlet_id: outlet.outlet_id,
        uid: null,
        email: s.email.toLowerCase(),
        role: "supervisor",
        created_at: nowIso,
      }),
    ),
  ];

  const staff: Staff[] = [];
  for (const member of config.staff) {
    staff.push(
      StaffSchema.parse({
        outlet_id: outlet.outlet_id,
        staff_id: member.staff_id,
        name: member.name,
        role: member.role,
        pin_hash: await hash(member.pin),
        failed_attempts: 0,
        locked_until: null,
        created_at: nowIso,
      }),
    );
  }

  const device: Device = DeviceSchema.parse({
    outlet_id: outlet.outlet_id,
    device_id: config.device.device_id,
    label: config.device.label,
    token_hash: null,
    paired_at: null,
    revoked: false,
    pairing_code: opts.pairingCode,
    pairing_code_expires_at: pairingCodeExpiry(opts.now),
    created_at: nowIso,
  });

  return { outlet, users, staff, device, pairingCode: opts.pairingCode };
}

// ── CLI wiring ───────────────────────────────────────────────────────────────
function parseProjectArg(argv: string[]): ProjectKind {
  const idx = argv.indexOf("--project");
  const value = idx !== -1 ? argv[idx + 1] : undefined;
  if (value !== "pilot" && value !== "demo") {
    throw new Error("Usage: npm run seed -- --project <pilot|demo>");
  }
  return value;
}

/** Refuses to seed demo data into the pilot project (and vice versa). */
function assertProjectMatchesEnv(project: ProjectKind): void {
  const demoMode = (process.env.DEMO_MODE ?? "").toLowerCase() === "true";
  if (project === "demo" && !demoMode) {
    throw new Error(
      "Refusing to seed --project demo without DEMO_MODE=true. The demo and " +
        "pilot outlets live in different GCP projects and must never mix.",
    );
  }
  if (project === "pilot" && demoMode) {
    throw new Error(
      "Refusing to seed --project pilot while DEMO_MODE=true. Point at the " +
        "pilot GCP project (DEMO_MODE unset) before seeding real data.",
    );
  }
}

function loadConfig(project: ProjectKind): SeedConfig {
  if (project === "demo") return SeedConfigSchema.parse(DEMO_SEED);
  // Pilot data is never committed — read it from an untracked file.
  const configPath = path.join(process.cwd(), "private", "seed.pilot.json");
  if (!existsSync(configPath)) {
    throw new Error(
      `Pilot seed config not found at ${configPath}. Create it (untracked, under ` +
        "/private/) with the real outlet, emails and staff. It must never be committed.",
    );
  }
  return SeedConfigSchema.parse(JSON.parse(readFileSync(configPath, "utf8")));
}

async function writeSeed(project: ProjectKind, docs: SeedDocuments): Promise<void> {
  const db = adminDb();
  const oid = docs.outlet.outlet_id;
  const batch = db.batch();

  batch.set(db.collection(COLLECTIONS.outlets).doc(oid), docs.outlet);
  for (const user of docs.users) {
    batch.set(
      db.collection(COLLECTIONS.users).doc(`${oid}:${user.email}`),
      user,
    );
  }
  for (const member of docs.staff) {
    batch.set(
      db.collection(COLLECTIONS.staff).doc(`${oid}:${member.staff_id}`),
      member,
    );
  }
  batch.set(
    db.collection(COLLECTIONS.devices).doc(`${oid}:${docs.device.device_id}`),
    docs.device,
  );
  await batch.commit();
}

async function main(): Promise<void> {
  const project = parseProjectArg(process.argv.slice(2));
  assertProjectMatchesEnv(project);

  const config = loadConfig(project);
  const docs = await buildSeedDocuments(config, project, {
    pairingCode: generatePairingCode(),
    now: new Date(),
  });
  await writeSeed(project, docs);

  console.log(`[seed] project=${project} outlet=${docs.outlet.outlet_id}`);
  console.log(`[seed] owner + ${docs.users.length - 1} supervisor(s), ${docs.staff.length} staff`);
  console.log(`[seed] device=${docs.device.device_id}`);
  console.log(
    `[seed] pairing code (valid 10 min): ${docs.pairingCode}  ` +
      `→ enter at /pair on the shop phone`,
  );
}

const isMainModule =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main().catch((error) => {
    console.error("[seed] failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
