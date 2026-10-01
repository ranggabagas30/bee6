/**
 * Developer-mode gate (DEV-01): a single source of truth for whether `/capture`
 * should render its dev-only manual control panel + event log. Gated on a
 * build-time `NEXT_PUBLIC_*` env var so it is baked into the client bundle at
 * build time — never a runtime toggle (e.g. a query param) that a real deploy
 * could be tricked into honouring. Must be `"false"` (or unset) in every
 * committed env template and every real build (pilot, demo); only a
 * developer's untracked `.env.local` sets it to `"true"`.
 */
export function isDevControlsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DEV_CONTROLS === "true";
}
