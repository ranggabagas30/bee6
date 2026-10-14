import { LangSwitch } from "@/app/shop/LangSwitch";
import { Button } from "@/app/ui";

/**
 * Shop-phone top bar (UX-03 section 5.12.1): the brand mark on the left, the ID | EN switch on the right.
 * `compact` (R-18, narrow screens with the sandbox script drawer only) tightens the space below it.
 * `signOut` (R-19 PR-4b, plan 5.7) adds the staff sign-out button before the switch. Only the demo sandbox's
 * /capture passes it; the pilot has no staff sign-out, so without it the bar is unchanged. The label is the
 * caller's copy, so this component stays copy-free.
 */
export function ShopTopBar({
  compact = false,
  signOut,
}: { compact?: boolean; signOut?: { label: string; onClick: () => void; disabled?: boolean } } = {}) {
  return (
    <header
      style={{
        position: "relative",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 8,
        minHeight: 48,
        marginBottom: compact ? 8 : 16,
      }}
    >
      <span style={{ fontSize: 20, fontWeight: 700 }}>bee6</span>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        {signOut ? (
          <Button variant="secondary" onClick={signOut.onClick} disabled={signOut.disabled} style={{ whiteSpace: "nowrap" }}>
            {signOut.label}
          </Button>
        ) : null}
        <LangSwitch />
      </div>
    </header>
  );
}
