import { connection } from "next/server";
import { readFirebaseWebConfig } from "@/lib/auth/web-config";
import { DayRecordApp } from "@/app/day/DayRecordApp";

/**
 * /day (R-06 Task 7.2). A server component so the Firebase web config is
 * read from `process.env` at request time, not baked into the build — same
 * runtime-env pattern as `app/sign-in/page.tsx`. No validation on the date
 * param here: the API answers 422 and the screen shows `C-day-invalid`.
 */
export default async function DayIndexPage() {
  await connection();
  return <DayRecordApp config={readFirebaseWebConfig()} dateParam="today" />;
}
