import type { CategoriesConfig } from "@/lib/pipeline/label/config";
import type { LabelUnit } from "@/lib/pipeline/windowing";
import type { OpenThread } from "@/lib/pipeline/threads";

/**
 * Prompt builder (R-05b, Task 1). Builds the system instruction + user
 * content for the label call from the loaded categories config, a
 * `LabelUnit`'s lines, and the caller's currently-open threads.
 *
 * Open threads are presented to the model as short aliases `O1..On`
 * (never the real `thread_id`, which can be long and is never something
 * the model needs to reproduce exactly — review focus #7/Decision 8). The
 * alias order matches `open_threads`'s own order, so the caller maps an
 * echoed `O#` back to the real thread by that same position.
 */

export interface LabelPromptResult {
  systemInstruction: string;
  userContent: string;
}

/** Tiffany's examples are still the literal string "TODO" for every category in `config/categories.draft.yaml`; never print that placeholder into a real model prompt. */
const TODO_PLACEHOLDER = "TODO";

function isPlaceholderExamples(examples: { real: string; not_this: string }): boolean {
  return examples.real === TODO_PLACEHOLDER || examples.not_this === TODO_PLACEHOLDER;
}

function buildSystemInstruction(config: CategoriesConfig): string {
  const lines: string[] = [
    "You label short work-note transcript lines from a small F&B shop into categories.",
    "Decide strictly in this order (earlier categories take precedence when more than one could apply):",
    config.decision_order.join(" > "),
    "",
    "Categories:",
  ];

  for (const category of config.decision_order) {
    const entry = config.categories[category];
    const notes: string[] = [];
    if (entry.always_question) notes.push("ALWAYS a debrief question, never an auto-fact");
    if (entry.needs_supervisor_confirm) notes.push("needs supervisor confirmation");
    const noteText = notes.length > 0 ? ` (${notes.join("; ")})` : "";

    lines.push(`- ${category}${noteText}: ${entry.definition}`);
    if (entry.examples && !isPlaceholderExamples(entry.examples)) {
      lines.push(`  real example: ${entry.examples.real}`);
      lines.push(`  NOT this (common confusion): ${entry.examples.not_this}`);
    }
  }

  lines.push(
    "",
    "Respond with structured output only, matching the given response schema:",
    "- lines[]: for every input line index i, say which thread it belongs to (`thread`, an alias",
    "  from this call's own set) and, if it is a reply/continuation of an earlier line in this same",
    "  unit, that earlier line's index as `reply_to` (otherwise null).",
    "- threads[]: one entry per NEW thread alias you used in lines[] (never for an echoed open",
    "  thread alias) with its category, confidence (0-1), evidence (the line indices that support",
    "  the label), an optional runner_up category + why_not if a close second category was",
    "  considered, optional category-specific fields, and a short summary.",
    "- non_work_lines[]: indices of lines that are private/non-work talk.",
  );

  return lines.join("\n");
}

function buildUserContent(unit: LabelUnit, openThreads: readonly OpenThread[]): string {
  const sections: string[] = [];

  if (openThreads.length > 0) {
    sections.push("Open threads from earlier (you may continue one by using its alias in `thread`):");
    openThreads.forEach((ot, idx) => {
      sections.push(`  O${idx + 1}: category=${ot.category}`);
    });
    sections.push("");
  }

  sections.push("Lines:");
  unit.lines.forEach((line, i) => {
    sections.push(`  ${i}: ${line.text}`);
  });

  return sections.join("\n");
}

export function buildLabelPrompt(input: {
  config: CategoriesConfig;
  unit: LabelUnit;
  open_threads: readonly OpenThread[];
}): LabelPromptResult {
  return {
    systemInstruction: buildSystemInstruction(input.config),
    userContent: buildUserContent(input.unit, input.open_threads),
  };
}
