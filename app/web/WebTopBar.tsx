import type { Auth } from "@/lib/auth/client/firebase-client";
import { LangSwitch } from "@/app/shop/LangSwitch";
import { SignOutButton } from "@/app/web/SignOutButton";

/**
 * Owner/supervisor top bar (R-06 Task 4.6). Same layout as
 * `app/shop/ShopTopBar.tsx` (brand left, controls right); `app/shop/*` is
 * read-only for this task, so this is a sibling component, not an edit to it.
 */
export function WebTopBar({ auth, showSignOut }: { auth: Auth | null; showSignOut: boolean }) {
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
      <div style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
        <LangSwitch />
        {showSignOut && auth ? <SignOutButton auth={auth} /> : null}
      </div>
    </header>
  );
}
