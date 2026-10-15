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
