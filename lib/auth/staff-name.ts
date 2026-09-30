/**
 * Staff-name normalization for the PIN-login lookup (web spec §3). Staff type
 * their name on the shop device; casing and stray spaces vary. We store the
 * display `name` as-is (in the `staff` collection only — hard rule #7) but also
 * store and match on a normalized `name_key` so "Ari  Demo", "ari demo" and
 * "  Ari Demo " all resolve to the same staff member.
 *
 * Normalization: trim, casefold (lowercase), and collapse internal whitespace.
 */
export function normalizeStaffName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}
