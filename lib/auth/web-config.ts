import { z } from "zod";

/**
 * Firebase web config (R-06 Task 4.1). Server-safe — no `"use client"` here.
 * Read from `process.env` at request time (not build time, so one Cloud Run
 * image serves both the pilot and the demo project, matching cloudbuild.yaml's
 * no-baked-values rule), then passed down to the client as a page prop.
 *
 * These four values are public identifiers by design, not secrets (already
 * named in `.env.example`): the Firebase web API key is scoped by Firebase
 * Auth / Security Rules, never by being secret.
 */
export const FirebaseWebConfigSchema = z
  .object({
    apiKey: z.string().min(1),
    authDomain: z.string().min(1),
    projectId: z.string().min(1),
    appId: z.string().min(1),
  })
  .strict();
export type FirebaseWebConfig = z.infer<typeof FirebaseWebConfigSchema>;

/**
 * Builds the Firebase web config from `FIREBASE_API_KEY` / `FIREBASE_AUTH_DOMAIN`
 * / `FIREBASE_PROJECT_ID` / `FIREBASE_APP_ID`. Any one missing or empty yields
 * `null` — never throws, so a misconfigured server shows the
 * "sign-in is not set up" message instead of a 500.
 */
export function readFirebaseWebConfig(
  env: Record<string, string | undefined> = process.env,
): FirebaseWebConfig | null {
  const parsed = FirebaseWebConfigSchema.safeParse({
    apiKey: env.FIREBASE_API_KEY,
    authDomain: env.FIREBASE_AUTH_DOMAIN,
    projectId: env.FIREBASE_PROJECT_ID,
    appId: env.FIREBASE_APP_ID,
  });
  return parsed.success ? parsed.data : null;
}
