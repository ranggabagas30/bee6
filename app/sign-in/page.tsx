import { connection } from "next/server";
import { readFirebaseWebConfig } from "@/lib/auth/web-config";
import { SignInScreen } from "@/app/sign-in/SignInScreen";

/**
 * /sign-in (R-06 Task 4.6, web spec §3). A server component so the Firebase
 * web config is read from `process.env` at request time, not baked into the
 * build — one Cloud Run image serves the pilot and the demo project
 * (cloudbuild.yaml's no-baked-values rule). `demo` (R-12) is DEMO_MODE read the same way: true only on
 * the demo deployment.
 */
export default async function SignInPage() {
  await connection();
  return <SignInScreen config={readFirebaseWebConfig()} demo={process.env.DEMO_MODE === "true"} />;
}
