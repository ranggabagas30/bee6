/**
 * The id of a thread's gate question (web spec §6.6.6). Written by the tick
 * (`lib/pipeline/tick/service.ts`) and read by R-06's day-record service —
 * shared here so neither side hand-rolls the `q_thread_` prefix.
 */
export function threadQuestionId(threadId: string): string {
  return `q_thread_${threadId}`;
}
