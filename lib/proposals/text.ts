/**
 * R-21: the model sometimes echoes the SOP rendering's role tag at the head of the step text
 * ("[staff] Take a phone order: ..."). Strip exactly that, once, at the head. Pure; the safety net behind the prompt rule.
 */
export function stripLeadingRoleTag(text: string): string {
  return text.replace(/^\s*(\[(staff|supervisor|owner)\]|\((role:\s*)?(staff|supervisor|owner)\))\s*/i, "");
}
