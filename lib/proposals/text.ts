/**
 * R-21: the model sometimes echoes the SOP rendering's role tag at the head of the step text
 * ("[staff] Take a phone order: ..."). Strip exactly that, once, at the head. Pure; the safety net behind the prompt rule.
 *
 * R-21 PR-C: If the text is only a role tag, fall back to the unstripped text instead of empty,
 * so ProposalContentSchema.min(1) doesn't throw a ZodError at the wire validation step.
 */
export function stripLeadingRoleTag(text: string): string {
  const stripped = text.replace(/^\s*(\[(staff|supervisor|owner)\]|\((role:\s*)?(staff|supervisor|owner)\))\s*/i, "");
  return stripped.trim() ? stripped : text;
}

/**
 * R-24 §3.4 rule 11: The model's own proposal texts. Pure; never stored.
 * Used for R-21 `--texts` flag and v4 check rule.
 */
export interface ProposedTexts {
  change_title: string;
  change_text: string;
  rationale: string;
}

/** Rules that identify wording a judge must never see. Pure. */
export const TEXT_RULES: readonly { label: string; re: RegExp }[] = [
  { label: "[staff]", re: /\[(staff|supervisor|owner)\]/i },
  { label: "(role:", re: /\(role:/i },
  { label: "ISO date", re: /\d{4}-\d{2}-\d{2}/ },
  { label: "phone number", re: /phone number/i },
  // R-21 PR-C: "name" must match customer/caller/person/their context, not "names", "rename", "menu item name".
  { label: "name", re: /\b(customer'?s?|caller'?s?|their|person'?s?)\s+name\b|name\s+(and|or)\s+(phone|number)/i },
];

/**
 * Check proposed texts for rule violations.
 * Returns an array of "field: label" strings for each violation found.
 */
export function findTextViolations(texts: ProposedTexts): string[] {
  const hits: string[] = [];
  for (const field of ["change_title", "change_text", "rationale"] as const) {
    for (const rule of TEXT_RULES) if (rule.re.test(texts[field])) hits.push(`${field}: ${rule.label}`);
  }
  return hits;
}
