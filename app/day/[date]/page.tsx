import { connection } from "next/server";
import { readFirebaseWebConfig } from "@/lib/auth/web-config";
import { DayRecordApp } from "@/app/day/DayRecordApp";

/**
 * /day/{date} (R-06 Task 7.2). Same server-config pattern as `app/day/page.tsx`.
 * `date` is passed through unvalidated: a malformed value reaches the API as
 * a 422, and `DayRecordApp` shows `C-day-invalid`.
 */
export default async function DayPage({ params }: { params: Promise<{ date: string }> }) {
  await connection();
  const { date } = await params;
  return <DayRecordApp config={readFirebaseWebConfig()} dateParam={date} />;
}
