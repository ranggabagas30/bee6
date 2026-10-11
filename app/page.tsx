import { connection } from "next/server";
import { readFirebaseWebConfig } from "@/lib/auth/web-config";
import { LandingLoader } from "@/app/demo/LandingLoader";

/**
 * "/" (R-12 Task 8.3). A server component so `DEMO_MODE` and the Firebase web config are read from
 * `process.env` at request time, not baked into the build: one image serves the pilot and the demo project.
 * On the demo deployment (DEMO_MODE exactly "true") it is the judge landing; anywhere else it is the plain
 * scaffold it always was, with no demo code or copy in its output. The landing is reached only through
 * `LandingLoader` (a lazy import), so the pilot's HTML does not even reference the landing or Firebase chunks.
 */
export default async function HomePage() {
  await connection();
  if (process.env.DEMO_MODE === "true") {
    return <LandingLoader config={readFirebaseWebConfig()} />;
  }
  return (
    <main>
      <h1>bee6</h1>
      <p>SOP Improvement Agent — scaffold in progress.</p>
    </main>
  );
}
