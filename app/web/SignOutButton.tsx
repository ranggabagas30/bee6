"use client";

import { useRouter } from "next/navigation";
import { signOut, type Auth } from "@/lib/auth/client/firebase-client";
import { useLang } from "@/lib/i18n/context";
import { t } from "@/lib/i18n/dict";
import { Button } from "@/app/ui";

/**
 * R-06 Task 4.6; page-2 look in R-25 T8 (the board's secondary "Sign out" button). `signOut` is best-effort: even if it
 * rejects (e.g. offline), the browser still navigates to `/sign-in` so the screen never gets stuck showing a Firebase
 * user with stale/no claims.
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
    <Button variant="secondary" onClick={handleClick}>
      {t(lang, "C-web-signout")}
    </Button>
  );
}
