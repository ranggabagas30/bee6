import axe from "axe-core";

/**
 * axe-core violations for a rendered subtree (test helper, never imported by app code). jsdom has no layout engine,
 * so the colour-contrast rule is off; contrast and real target sizes belong to the live QA run.
 */
export async function axeViolations(container: Element): Promise<string[]> {
  const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  return results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`);
}
