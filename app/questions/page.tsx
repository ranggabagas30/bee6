import { connection } from "next/server";
import { readFirebaseWebConfig } from "@/lib/auth/web-config";
import { QueueApp } from "@/app/questions/QueueApp";

/**
 * /questions (R-06 Task 13.6). The supervisor review queue. Same runtime-env
 * server-component pattern as `app/day/page.tsx` / `app/home/page.tsx`.
 */
export default async function QuestionsPage() {
  await connection();
  return <QueueApp config={readFirebaseWebConfig()} />;
}
