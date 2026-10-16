import type { SopStep } from "@/lib/firestore/schema";

/**
 * R-24 §0.2: Derive sections from SOP steps, deterministically, with no schema change.
 * Each section collects steps sharing a common section id, derived from the step's
 * title (matching the "Section · Title" convention) or from the step_id prefix.
 * Degenerate case: if only one section results, or every section has exactly one step,
 * collapse to a single "all" section containing all steps (whole-SOP behavior).
 */

export interface SopSection {
  section_id: string;
  title: string;
  step_ids: string[];
}

/** Slug: lowercase, `[^a-z0-9]+` → `-`, trim, max 40 chars. */
function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * Derive a section id and title from a step.
 * If the title matches "Section · Title" (group 1 is 1–60 chars), use that.
 * Otherwise, strip trailing -<digits> from step_id and use lowercase with - → space as title.
 * Return { sectionId, sectionTitle }.
 */
function deriveSectionFromStep(step: SopStep): { sectionId: string; sectionTitle: string } {
  const match = step.title.match(/^(.{1,60}?)\s·\s(.+)$/);
  if (match && match[1]) {
    const slugged = slug(match[1]);
    // Fall through to step_id path if slug is empty
    if (slugged) {
      return {
        sectionId: slugged,
        sectionTitle: match[1],
      };
    }
  }
  // Strip trailing -?digits (hyphen optional) from step_id
  const withoutTrailing = step.step_id.replace(/-?\d+$/, "");
  const sectionId = withoutTrailing || step.step_id;
  const sectionTitle = sectionId.replace(/-/g, " ");
  return { sectionId, sectionTitle };
}

/**
 * Derive sections from SOP steps. Sections preserve first-appearance order;
 * steps within each section are in SOP order.
 * Degenerate collapse: if only one section or every section has exactly one step,
 * return a single section { section_id: "all", title: "Whole SOP", step_ids: [...all] }.
 */
export function deriveSections(steps: readonly SopStep[]): SopSection[] {
  if (steps.length === 0) return [];

  // Build a map of sectionId -> { title, steps in order }
  const sectionMap = new Map<string, { title: string; stepIds: string[] }>();
  const sectionOrder: string[] = [];

  for (const step of steps) {
    const { sectionId, sectionTitle } = deriveSectionFromStep(step);
    if (!sectionMap.has(sectionId)) {
      sectionMap.set(sectionId, { title: sectionTitle, stepIds: [] });
      sectionOrder.push(sectionId);
    }
    sectionMap.get(sectionId)!.stepIds.push(step.step_id);
  }

  // Convert to array in first-appearance order
  const sections = sectionOrder.map((id) => {
    const { title, stepIds } = sectionMap.get(id)!;
    return { section_id: id, title, step_ids: stepIds };
  });

  // Degenerate collapse: one section or every section has exactly one step
  const isDegenerate =
    sections.length === 1 || sections.every((s) => s.step_ids.length === 1);
  if (isDegenerate) {
    const allStepIds = steps.map((s) => s.step_id);
    return [
      {
        section_id: "all",
        title: "Whole SOP",
        step_ids: allStepIds,
      },
    ];
  }

  return sections;
}
