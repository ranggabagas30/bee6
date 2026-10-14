/**
 * Keys that a v2 slice shares with the base dictionary or with an earlier slice, as `"key (slice)"`.
 * dict.ts spreads the slices over the base, so a clash would silently replace copy; the v2 test asserts this is empty.
 */
export function clashingKeys(
  base: Readonly<Record<string, string>>,
  slices: Readonly<Record<string, Readonly<Record<string, string>>>>,
): string[] {
  const seen = new Set(Object.keys(base));
  const clashes: string[] = [];
  for (const [name, slice] of Object.entries(slices)) {
    for (const key of Object.keys(slice)) {
      if (seen.has(key)) clashes.push(`${key} (${name})`);
      seen.add(key);
    }
  }
  return clashes;
}
