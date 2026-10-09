import { connection } from "next/server";
import { readFirebaseWebConfig } from "@/lib/auth/web-config";
import { HomeApp } from "@/app/home/HomeApp";

/**
 * /home (R-06 Task 14a). The owner's start page after sign-in (web spec §4.4,
 * Rangga v4 Q-G). Same runtime-env server-component pattern as
 * `app/day/page.tsx`.
 */
export default async function HomePage() {
  await connection();
  return <HomeApp config={readFirebaseWebConfig()} />;
}
