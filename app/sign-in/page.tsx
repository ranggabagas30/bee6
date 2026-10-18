import { connection } from "next/server";
import { redirect } from "next/navigation";
import { readFirebaseWebConfig } from "@/lib/auth/web-config";
import { SignInScreen } from "@/app/sign-in/SignInScreen";
import { parseSignInRole } from "@/app/sign-in/roles";

/**
 * /sign-in (R-06 Task 4.6, web spec §3; the official role sign-in since R-18 P1). A server component so the Firebase
 * web config is read from `process.env` at request time, not baked into the build — one Cloud Run image serves the pilot
 * and the demo project (cloudbuild.yaml's no-baked-values rule). `demo` (R-12) is DEMO_MODE read the same way: true only on
 * the demo deployment. `?as=staff|supervisor|owner` picks the panel; anything else is ignored. With no valid value the
 * pilot asks who the visitor is, and the demo deployment starts on Staff (the judge path begins there).
 *
 * Demo-feedback-2 item 12/13/14: on demo, redirect staff to /pair and bare/invalid URLs to /.
 */
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  await connection();
  const demo = process.env.DEMO_MODE === "true";
  const { as } = await searchParams;
  const role = parseSignInRole(as);

  // Demo-only redirects (pilot unchanged)
  if (demo) {
    if (role === "staff") redirect("/pair");
    if (role === null) redirect("/");
  }

  return <SignInScreen config={readFirebaseWebConfig()} demo={demo} initialRole={role ?? (demo ? "staff" : null)} />;
}
