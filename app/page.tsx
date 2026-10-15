import { connection } from "next/server";
import { redirect } from "next/navigation";
import { EntryLanding } from "@/app/web/EntryLanding";

/**
 * "/" (R-12 Task 8.3, R-18 P1, reworked in R-19 PR-6 §8.1). A server component so `DEMO_MODE` is read from
 * `process.env` at request time, not baked into the build: one image serves the pilot and the demo project.
 *
 * On the pilot (DEMO_MODE not exactly "true") it redirects to /sign-in before rendering anything: no demo copy is in
 * its output. On the demo deployment it is the page-1 W1 entry page: three role cards (Staff → /pair, Supervisor and
 * Owner → the role sign-in). No sign-in form and no demo code here: the judge guide carries the way in (W8).
 */
export default async function HomePage() {
  await connection();
  if (process.env.DEMO_MODE !== "true") redirect("/sign-in");
  return <EntryLanding />;
}
