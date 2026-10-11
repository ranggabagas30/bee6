/**
 * Seeds the R-12 demo TEMPLATE outlet through the REAL path (T-703: "sent through the real
 * /api/v1/segments endpoint ... no hand-written outputs"). It acts as a phone: pairs the template
 * device, opens backdated Mulai sessions, PUTs each fictional clip to the deployed segment route,
 * and ends each session. The deployed pipeline tick (every 2 min) then windows, labels and gates
 * it, and writes the questions. This script never writes Firestore: it only POSTs/PUTs to the
 * deployed service and, to report progress, reads counts with the Admin SDK (read-only).
 *
 * Runbook (Rangga, demo project bee6-playground only):
 *   1. `npm run seed -- --project demo --template` (needs DEMO_MODE=true) -> note the pairing code.
 *   2. Put Tiffany's fictional clips and `plan.json` in a directory that git ignores (the runbook names it).
 *   3. Within 10 minutes of step 1:
 *        npm run demo:seed-template -- --base-url <demo service URL> --code <pairing code> \
 *          --clips-dir <that directory>
 *      `--clips-dir` is mandatory (there is no default directory); `--plan <file>` defaults to
 *      `plan.json` inside it.
 *   4. Wait for "done": the template is ready. Re-run the whole thing only if the clips change
 *      (delete the `demo-tpl-outlet` data first via dev-ops).
 *
 * plan.json shape (zod-validated below):
 *   { "days": [ { "offset_days": -3, "start_hm": "07:00", "end_hm": "21:45",
 *                 "clips": [ { "file": "clip-1.webm", "at_hm": "09:00", "duration_ms": 12000 } ] } ] }
 *   Each clip is one WebM/Opus segment of at most 15 s (the real segment contract). The script
 *   never cuts audio. `duration_ms` is the clip length, used for the device end time.
 *
 * Before pairing it checks that --base-url answers like a demo service (a read-only GET; see assertDemoService)
 * and refuses otherwise, so the single-use pairing code is never sent to a pilot or unrelated service.
 *
 * Hard rules: audio is read from disk, sent in the request body and never stored, logged or
 * echoed (#2); the device token is held in memory only (never written, never logged); logs print
 * counts and routes, never text.
 */
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { addDays, localDateOf, zonedTimeToEpochMs } from "@/lib/capture/calendar";
import { MAX_SEGMENT_BYTES, SEGMENT_CONTENT_TYPE } from "@/lib/capture/contract";
import { deviceAuthHeaders, type DeviceAuth } from "@/lib/capture/browser/client";
import { TEMPLATE_DEVICE_ID, TEMPLATE_OUTLET_ID } from "@/lib/demo/constants";

/** The pilot GCP project (real shop data). This script is for the demo project only and refuses to run against it. */
export const PILOT_PROJECT_ID = "project-a10437b4-b198-402e-97e";

const TZ = "Asia/Jakarta";
/** Same rate the browser engine uploads at. */
const SAMPLE_RATE = 16_000;
/** One segment is at most 15 s (the real segment contract). */
export const CLIP_MAX_MS = 15_000;
const SEGMENT_ATTEMPTS = 3;
const SEGMENT_RETRY_MS = 2_000;

// ── plan.json ────────────────────────────────────────────────────────────────
const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const minutesOf = (value: string): number => {
  const [h, m] = value.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

const ClipSchema = z
  .object({
    /** File name inside the clips directory; no path parts. */
    file: z.string().min(1).regex(/^[A-Za-z0-9._-]+$/).refine((f) => !f.includes(".."), "no path parts"),
    at_hm: hm,
    duration_ms: z.number().int().min(1).max(CLIP_MAX_MS),
  })
  .strict();

const DaySchema = z
  .object({
    offset_days: z.union([z.literal(-3), z.literal(-2), z.literal(-1)]),
    start_hm: hm,
    end_hm: hm,
    clips: z.array(ClipSchema).min(1).max(20),
  })
  .strict()
  .superRefine((day, ctx) => {
    const start = minutesOf(day.start_hm);
    const end = minutesOf(day.end_hm);
    if (end <= start) ctx.addIssue({ code: "custom", message: "end_hm must be after start_hm", path: ["end_hm"] });
    day.clips.forEach((clip, i) => {
      const at = minutesOf(clip.at_hm);
      const clipEnd = at + clip.duration_ms / 60_000;
      if (at < start || clipEnd > end) {
        ctx.addIssue({ code: "custom", message: "clip is outside the session", path: ["clips", i, "at_hm"] });
      }
    });
  });

export const PlanSchema = z
  .object({ days: z.array(DaySchema).min(1).max(3) })
  .strict()
  .refine((p) => new Set(p.days.map((d) => d.offset_days)).size === p.days.length, "duplicate offset_days");
export type Plan = z.infer<typeof PlanSchema>;

// ── errors ───────────────────────────────────────────────────────────────────
/** Message carries the method, route and status only: never a body, token or text. */
export class TemplateSeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateSeedError";
  }
}

// ── progress ─────────────────────────────────────────────────────────────────
export interface DayProgress {
  date: string;
  threads: { fact: number; open: number; unverified: number };
  questions: { open: number; unverified: number; answered: number };
}
export interface ProgressSnapshot {
  days: DayProgress[];
  /** label_units still pending: the tick has not labelled every unit yet. */
  pending_units: number;
}

export interface TemplateSeedDeps {
  baseUrl: string;
  code: string;
  plan: Plan;
  tz?: string;
  nowMs: number;
  fetchFn: typeof fetch;
  /** Reads one clip's bytes. Bytes are sent as the request body and never logged. */
  readClip: (file: string) => Promise<Uint8Array>;
  randomUUID: () => string;
  readProgress: () => Promise<ProgressSnapshot>;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
  pollEveryMs: number;
  pollMaxMs: number;
}

// ── HTTP, exactly like the phone ─────────────────────────────────────────────
async function send(
  deps: TemplateSeedDeps,
  method: "POST" | "PUT",
  route: string,
  headers: Record<string, string>,
  body: BodyInit,
  attempts = 1,
): Promise<unknown> {
  let lastStatus = 0;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let res: Response;
    try {
      res = await deps.fetchFn(`${deps.baseUrl}${route}`, { method, headers, body });
    } catch {
      lastStatus = 0;
      if (attempt < attempts) await deps.sleep(SEGMENT_RETRY_MS);
      continue;
    }
    if (res.ok) {
      const payload: { data?: unknown } | null = await res.json().catch(() => null);
      return payload?.data;
    }
    lastStatus = res.status;
    // Only a 503 is transient (the phone retries it too); everything else is final.
    if (res.status !== 503) break;
    if (attempt < attempts) await deps.sleep(SEGMENT_RETRY_MS);
  }
  throw new TemplateSeedError(`${method} ${route} failed with status ${lastStatus === 0 ? "network error" : lastStatus}`);
}

const jsonHeaders = (auth?: DeviceAuth): Record<string, string> => ({
  "Content-Type": "application/json",
  ...(auth ? deviceAuthHeaders(auth) : {}),
});

function describeDay(d: DayProgress): string {
  const t = d.threads;
  const q = d.questions;
  return `[demo-seed] ${d.date} threads fact=${t.fact} open=${t.open} unverified=${t.unverified} questions open=${q.open} unverified=${q.unverified} answered=${q.answered}`;
}

function isDone(progress: ProgressSnapshot, dates: readonly string[]): boolean {
  if (progress.pending_units > 0) return false;
  return dates.every((date) => {
    const day = progress.days.find((d) => d.date === date);
    return day !== undefined && day.threads.fact + day.threads.open + day.threads.unverified >= 1;
  });
}

/**
 * Proves the base URL is a DEMO service before any state-changing call. The pairing code is single use and
 * the pair route cannot be asked who owns a code without consuming it, so the check is on the service: the
 * fast-forward route is demo only and answers a wrong method (here GET, no token, no body, read-only) with
 * 405 + `Allow: POST` when DEMO_MODE is on, and with the same 404 as any missing route when it is off (the
 * pilot never sets DEMO_MODE). Anything else, including a network error, refuses the run.
 */
async function assertDemoService(deps: TemplateSeedDeps): Promise<void> {
  const refuse = () =>
    new TemplateSeedError("The base URL did not identify itself as a demo service; nothing was sent. Check --base-url.");
  let res: Response;
  try {
    res = await deps.fetchFn(`${deps.baseUrl}/api/v1/reviews/fast-forward`, { method: "GET" });
  } catch {
    throw refuse();
  }
  const allow = (res.headers.get("allow") ?? "").toUpperCase();
  if (res.status !== 405 || !allow.split(",").some((m) => m.trim() === "POST")) throw refuse();
}

/** The whole run. Throws `TemplateSeedError` on any failure; resolves when the tick has produced every day. */
export async function runTemplateSeed(deps: TemplateSeedDeps): Promise<void> {
  const tz = deps.tz ?? TZ;

  // 0. Refuse a service that is not a demo service, before the single-use pairing code is spent.
  await assertDemoService(deps);

  // 1. Pair. The token stays in this function's memory.
  const paired = (await send(deps, "POST", "/api/v1/devices/pair", jsonHeaders(), JSON.stringify({ code: deps.code }))) as
    | { device_id?: string; outlet_id?: string; device_token?: string }
    | undefined;
  if (
    !paired ||
    paired.device_id !== TEMPLATE_DEVICE_ID ||
    paired.outlet_id !== TEMPLATE_OUTLET_ID ||
    typeof paired.device_token !== "string"
  ) {
    throw new TemplateSeedError("The pairing code is not for the demo template device; nothing was uploaded.");
  }
  const auth: DeviceAuth = { deviceToken: paired.device_token, deviceId: paired.device_id };
  deps.log("[demo-seed] paired the template device");

  const today = localDateOf(deps.nowMs, tz);
  const days = [...deps.plan.days].sort((a, b) => a.offset_days - b.offset_days); // oldest first
  const dates: string[] = [];

  for (const day of days) {
    const date = addDays(today, day.offset_days);
    dates.push(date);
    const startedAt = zonedTimeToEpochMs(date, day.start_hm, tz);
    const endedAt = zonedTimeToEpochMs(date, day.end_hm, tz);
    const sessionId = deps.randomUUID();

    await send(deps, "POST", "/api/v1/capture/sessions", jsonHeaders(auth), JSON.stringify({ session_id: sessionId, started_at_ms: startedAt }));

    for (const clip of day.clips) {
      const bytes = await deps.readClip(clip.file);
      if (bytes.byteLength > MAX_SEGMENT_BYTES) {
        throw new TemplateSeedError(`Clip ${clip.file} is larger than the segment ceiling; the script never cuts audio.`);
      }
      const segId = deps.randomUUID();
      const start = zonedTimeToEpochMs(date, clip.at_hm, tz);
      await send(
        deps,
        "PUT",
        `/api/v1/segments/${auth.deviceId}:${segId}`,
        {
          ...deviceAuthHeaders(auth),
          "Content-Type": SEGMENT_CONTENT_TYPE,
          "X-Segment-Start-Ms": String(start),
          "X-Segment-End-Ms": String(start + clip.duration_ms),
          "X-Segment-Sample-Rate": String(SAMPLE_RATE),
          "X-Session-Id": sessionId,
        },
        bytes as BodyInit,
        SEGMENT_ATTEMPTS,
      );
    }

    await send(
      deps,
      "POST",
      `/api/v1/capture/sessions/${sessionId}/end`,
      jsonHeaders(auth),
      JSON.stringify({ started_at_ms: startedAt, ended_at_ms: endedAt, end_reason: "selesai" }),
    );
    deps.log(`[demo-seed] ${date} uploaded ${day.clips.length} clip(s) and ended the session`);
  }

  // 3. Poll until the tick has produced every day.
  let waited = 0;
  for (;;) {
    const progress = await deps.readProgress();
    for (const d of progress.days) deps.log(describeDay(d));
    if (isDone(progress, dates)) {
      deps.log("[demo-seed] done: the template is ready");
      return;
    }
    if (waited >= deps.pollMaxMs) {
      throw new TemplateSeedError("Timed out waiting for the pipeline tick to process the template.");
    }
    await deps.sleep(deps.pollEveryMs);
    waited += deps.pollEveryMs;
  }
}

// ── CLI wiring ───────────────────────────────────────────────────────────────
function argValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i === -1 ? undefined : argv[i + 1];
}

export interface CliArgs {
  baseUrl: string;
  code: string;
  clipsDir: string;
  planPath: string;
}

/** Parses and validates the command line. `--clips-dir` is mandatory: the script never guesses where audio lives. */
export function parseCliArgs(argv: string[]): CliArgs {
  const usage =
    "Usage: npm run demo:seed-template -- --base-url <demo service URL> --code <6-digit pairing code> --clips-dir <directory> [--plan <file>]";
  const baseUrl = argValue(argv, "--base-url")?.replace(/\/+$/, "");
  const code = argValue(argv, "--code");
  const clipsDirArg = argValue(argv, "--clips-dir");
  if (!baseUrl || !code || !/^\d{6}$/.test(code)) throw new TemplateSeedError(usage);
  if (!clipsDirArg || clipsDirArg.startsWith("--")) {
    throw new TemplateSeedError(`--clips-dir is required (there is no default directory). ${usage}`);
  }
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new TemplateSeedError("--base-url must be https (or localhost for a dev server).");
  }
  const clipsDir = path.resolve(clipsDirArg);
  const planArg = argValue(argv, "--plan");
  return { baseUrl, code, clipsDir, planPath: planArg ? path.resolve(planArg) : path.join(clipsDir, "plan.json") };
}

/** Parsed JSON of a credentials file, or null when it is missing or unreadable. */
type ReadJson = (file: string) => Record<string, unknown> | null;
const readJsonFile: ReadJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
};

/**
 * Refuses to run when the environment or the Application Default Credentials point at the pilot
 * project: this script seeds fictional demo data and must never touch real shop data. Checks the
 * project env vars and the project / quota project named inside the credentials file (the env path,
 * and gcloud's default one). Names only the project kind in the message, never a path or a value.
 */
export function assertNotPilotProject(env: Record<string, string | undefined>, readJson: ReadJson = readJsonFile): void {
  const seen: unknown[] = [env.GOOGLE_CLOUD_PROJECT, env.GCLOUD_PROJECT, env.GOOGLE_CLOUD_QUOTA_PROJECT];
  const files = [
    env.GOOGLE_APPLICATION_CREDENTIALS,
    path.join(env.HOME ?? os.homedir(), ".config", "gcloud", "application_default_credentials.json"),
  ];
  for (const file of files) {
    if (!file) continue;
    const creds = readJson(file);
    if (creds) seen.push(creds.project_id, creds.quota_project_id);
  }
  if (seen.includes(PILOT_PROJECT_ID)) {
    throw new TemplateSeedError(
      "Refusing to run: the Google Cloud project (or its credentials) is the PILOT project. This script seeds fictional demo data on the demo project only.",
    );
  }
}

/** Read-only counts for the progress report (Admin SDK `.get()` only; never prints text). */
async function readProgressFromFirestore(tz: string): Promise<ProgressSnapshot> {
  const { adminDb } = await import("@/lib/firebase/admin");
  const { COLLECTIONS } = await import("@/lib/firestore/collections");
  const db = adminDb();
  const where = (c: string) => db.collection(c).where("outlet_id", "==", TEMPLATE_OUTLET_ID);

  const byDate: Record<string, DayProgress> = {};
  const dayOf = (date: string): DayProgress =>
    (byDate[date] ??= { date, threads: { fact: 0, open: 0, unverified: 0 }, questions: { open: 0, unverified: 0, answered: 0 } });

  const threads = await where(COLLECTIONS.threads).get();
  for (const doc of threads.docs) {
    const t = doc.data() as { status: "fact" | "open" | "unverified"; first_line_start_ms: number };
    dayOf(localDateOf(t.first_line_start_ms, tz)).threads[t.status] += 1;
  }
  const questions = await where(COLLECTIONS.questions).get();
  for (const doc of questions.docs) {
    const q = doc.data() as { status: "open" | "unverified" | "answered"; window_start_ms: number };
    dayOf(localDateOf(q.window_start_ms, tz)).questions[q.status] += 1;
  }
  const units = await where(COLLECTIONS.labelUnits).where("status", "==", "pending").get();
  return { days: Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date)), pending_units: units.size };
}

async function main(): Promise<void> {
  assertNotPilotProject(process.env);
  const { baseUrl, code, clipsDir, planPath } = parseCliArgs(process.argv.slice(2));
  const plan = PlanSchema.parse(JSON.parse(await readFile(planPath, "utf8")));

  await runTemplateSeed({
    baseUrl,
    code,
    plan,
    nowMs: Date.now(),
    fetchFn: fetch,
    readClip: async (file) => new Uint8Array(await readFile(path.join(clipsDir, file))),
    randomUUID,
    readProgress: () => readProgressFromFirestore(TZ),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: (line) => console.log(line),
    pollEveryMs: 30_000,
    pollMaxMs: 15 * 60_000,
  });
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main().catch((error) => {
    // Status and route only (TemplateSeedError); never a body, token or clip.
    console.error("[demo-seed] failed:", error instanceof Error ? error.message : "unknown error");
    process.exitCode = 1;
  });
}
