import { connection } from "next/server";
import { readFirebaseWebConfig } from "@/lib/auth/web-config";
import { PairScreen } from "@/app/pair/PairScreen";

/**
 * /pair (web spec §3, §4.1; R-19 PR-6 §8.1). A server component so `DEMO_MODE` and the Firebase web config are read from
 * `process.env` at request time, not baked into the build (one image serves the pilot and the demo project). The demo
 * flag only decides whether the screen loads the demo box; the screen and its copy are the same on both deployments.
 */
export default async function PairPage() {
  await connection();
  return <PairScreen demo={process.env.DEMO_MODE === "true"} config={readFirebaseWebConfig()} />;
}
