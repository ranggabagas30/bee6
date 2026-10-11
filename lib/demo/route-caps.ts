import { AppError } from "@/lib/http/errors";
import { assertPermission, type Permission } from "@/lib/auth/rbac";
import type { CustomClaims } from "@/lib/auth/roles";
import { firestoreDemoStore } from "@/lib/firestore/demo-store";
import { enforceDemoCaps, type DemoCapKey } from "@/lib/demo/caps";
import { SANDBOX_OUTLET_PREFIX } from "@/lib/demo/constants";

/**
 * The one call a model-spending route makes (R-12 H2): place it AFTER authentication, the permission
 * check and body validation and BEFORE the first Gemini or Sensitive Data Protection call.
 *
 * Inert, with no store built and no read, unless DEMO_MODE is exactly "true" AND the caller's outlet id
 * is a sandbox id (`sbx-...`; the pilot and the shared demo outlet never are). For a sandbox it reads the
 * outlet once (for the expiry used in Retry-After) and applies the generic caps. An unreadable sandbox
 * outlet fails closed (503) rather than letting a request spend uncapped.
 */
export async function enforceDemoCapsForRoute(
  key: DemoCapKey,
  claims: Pick<CustomClaims, "outlet_id" | "role">,
  permission?: Permission,
): Promise<void> {
  if (process.env.DEMO_MODE !== "true") return;
  if (!claims.outlet_id.startsWith(SANDBOX_OUTLET_PREFIX)) return;
  // Only an authorised caller may spend a cap. The service repeats this check; here it just runs first.
  if (permission !== undefined) assertPermission(claims, permission);
  const store = firestoreDemoStore();
  const outlet = await store.getOutlet(claims.outlet_id);
  if (!outlet) throw new AppError("The demo is not ready", "demo_not_ready", 503);
  await enforceDemoCaps(store, { outlet, now_ms: Date.now(), key });
}
