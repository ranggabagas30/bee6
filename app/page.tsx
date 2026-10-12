import { connection } from "next/server";
import { redirect } from "next/navigation";
import { readFirebaseWebConfig } from "@/lib/auth/web-config";
import { SignInScreen } from "@/app/sign-in/SignInScreen";
import { parseSignInRole } from "@/app/sign-in/roles";
import { DemoIntro } from "@/app/demo/DemoIntro";

/**
 * "/" (R-12 Task 8.3, reworked in R-18 P1). A server component so `DEMO_MODE` and the Firebase web config are read from
 * `process.env` at request time, not baked into the build: one image serves the pilot and the demo project.
 *
 * On the pilot (DEMO_MODE not exactly "true") it redirects to /sign-in before rendering anything: no demo code or copy is
 * in its output. On the demo deployment it is the intro above the same role sign-in as /sign-in (Staff preselected), whose
 * demo access box is loaded lazily by `RoleSignIn`.
 */
export default async function HomePage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  await connection();
  if (process.env.DEMO_MODE !== "true") redirect("/sign-in");
  const { as } = await searchParams;
  return (
    <SignInScreen config={readFirebaseWebConfig()} demo variant="home" initialRole={parseSignInRole(as) ?? "staff"}>
      <DemoIntro />
    </SignInScreen>
  );
}
