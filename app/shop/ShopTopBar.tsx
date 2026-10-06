import { LangSwitch } from "@/app/shop/LangSwitch";

/** Shop-phone top bar (UX-03 section 5.12.1): the brand mark on the left, the ID | EN switch on the right. */
export function ShopTopBar() {
  return (
    <header
      style={{
        position: "relative",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        minHeight: 48,
        marginBottom: 16,
      }}
    >
      <span style={{ fontSize: 20, fontWeight: 700 }}>bee6</span>
      <LangSwitch />
    </header>
  );
}
