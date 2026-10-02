import type { LabelOutput, OpenThread } from "@/lib/pipeline/threads";

/**
 * Maps a label call's echoed open-thread aliases (`O1..On`, built by
 * `buildLabelPrompt` in the SAME order as the `open_threads` it was given)
 * back to the real stored `thread_id` — the handoff point PR1's
 * tech-lead review flagged as owned by Task 6 (the sanitizer passes `O#`
 * through unchanged on purpose; `buildThreads`'s own join logic matches a
 * line's `thread` hint against `OpenThread.thread_id` literally, so an
 * un-remapped `"O1"` could never match a real open thread).
 *
 * `T#` aliases (new threads) and anything that isn't an `O#` pattern are
 * left unchanged — `buildThreads` needs the model's own bare id there to
 * build the fresh `${unit_id}:${modelThreadId}` thread id.
 */

const OPEN_ALIAS_RE = /^O(\d+)$/;

function resolveAlias(alias: string, openThreads: readonly OpenThread[]): string {
  const match = OPEN_ALIAS_RE.exec(alias);
  if (!match) return alias;
  const idx = Number(match[1]) - 1;
  const openThread = openThreads[idx];
  // An out-of-range O# (shouldn't happen — the wire schema's enum only ever
  // offers aliases up to open_threads.length) is left as-is rather than
  // thrown: buildThreads simply won't find a matching open thread for it,
  // same outcome as any other unresolved hint.
  return openThread ? openThread.thread_id : alias;
}

export function remapOpenThreadAliases(label: LabelOutput, openThreads: readonly OpenThread[]): LabelOutput {
  return {
    lines: label.lines.map((line) => ({ ...line, thread: resolveAlias(line.thread, openThreads) })),
    threads: label.threads.map((thread) => ({ ...thread, id: resolveAlias(thread.id, openThreads) })),
    non_work_lines: [...label.non_work_lines],
  };
}
