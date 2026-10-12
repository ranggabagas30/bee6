import { LangSwitch } from "@/app/shop/LangSwitch";

/**
 * Shop-phone top bar (UX-03 section 5.12.1): the brand mark on the left, the ID | EN switch on the right.
 * `compact` (R-18, narrow screens with the sandbox script drawer only) tightens the space below it.
 */
export function ShopTopBar({ compact = false }: { compact?: boolean } = {}) {
  return (
    <header
      style={{
        position: "relative",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        minHeight: 48,
        marginBottom: compact ? 8 : 16,
      }}
    >
      <span style={{ fontSize: 20, fontWeight: 700 }}>bee6</span>
      <LangSwitch />
    </header>
  );
}
