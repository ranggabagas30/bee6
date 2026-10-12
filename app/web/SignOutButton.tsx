"use client";

import { useRouter } from "next/navigation";
import { signOut, type Auth } from "@/lib/auth/client/firebase-client";
import { useLang } from "@/lib/i18n/context";
import { t } from "@/lib/i18n/dict";

/**
 * R-06 Task 4.6. A 48 px text button. `signOut` is best-effort: even if it
 * rejects (e.g. offline), the browser still navigates to `/sign-in` so the
 * screen never gets stuck showing a Firebase user with stale/no claims.
 */
export function SignOutButton({ auth }: { auth: Auth }) {
  const { lang } = useLang();
  const router = useRouter();

  async function handleClick() {
    try {
      await signOut(auth);
    } catch {
      // Best-effort: still navigate away.
    }
    router.replace("/sign-in");
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      style={{ minHeight: 48, minWidth: 48, padding: "0 12px", fontSize: 16 }}
    >
      {t(lang, "C-web-signout")}
    </button>
  );
}
