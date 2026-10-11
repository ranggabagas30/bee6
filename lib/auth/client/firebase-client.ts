import { getApps, initializeApp } from "firebase/app";
import {
  getAuth,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
} from "firebase/auth";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";

/**
 * Browser `Auth` singleton (R-06 Task 4.2). A named app (`APP_NAME`) so this
 * never collides with another Firebase app a later feature might initialise,
 * and so a Next.js hot reload / repeated render does not re-initialise it.
 *
 * Default persistence (browser local) is kept: a supervisor stays signed in on
 * their own phone across visits.
 */
const APP_NAME = "bee6-web";

export function getClientAuth(config: FirebaseWebConfig): Auth {
  const app = getApps().find((a) => a.name === APP_NAME) ?? initializeApp(config, APP_NAME);
  return getAuth(app);
}

/**
 * Re-exported so every other module (components, `lib/day/*`) imports
 * `firebase/auth` functions and types only through `lib/auth/client/`, with
 * no exception needed in the import-ban test (Task 4.7).
 */
export { signInWithCustomToken, signInWithEmailAndPassword, signOut };
export type { Auth, User } from "firebase/auth";
