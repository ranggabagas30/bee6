import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EN, ID, t, type DictKey } from "@/lib/i18n/dict";

/**
 * R-12 PR-B Task 8.1: the demo landing / demo bar copy block (all PROVISIONAL,
 * plan copy plus the keys the error and restart states need).
 */

const DEMO_KEYS = [
  "C-demo-title",
  "C-demo-intro",
  "C-demo-path",
  "C-demo-fictional",
  "C-demo-bar",
  "C-demo-switch",
  "C-demo-role-staff",
  "C-demo-role-supervisor",
  "C-demo-role-owner",
  "C-demo-busy",
  "C-demo-expired",
  "C-demo-restart",
  "C-demo-restart-confirm",
  "C-demo-restart-yes",
  "C-demo-restart-keep",
  "C-demo-restarted",
  "C-demo-err-limit",
  "C-demo-err-cap",
  "C-demo-err-busy",
  "C-demo-err-not-ready",
  "C-demo-retry-soon",
  "C-demo-retry-min",
  "C-demo-retry-hr",
  "C-demo-retry-tomorrow",
  "C-demo-retry-later",
] as const satisfies readonly DictKey[];

describe("R-12 demo copy block", () => {
  it("defines every demo key in both languages, non-empty", () => {
    for (const key of DEMO_KEYS) {
      expect(ID[key]?.trim().length, `ID ${key}`).toBeGreaterThan(0);
      expect(EN[key]?.trim().length, `EN ${key}`).toBeGreaterThan(0);
    }
  });

  it("fills the bar and switch placeholders", () => {
    expect(t("en", "C-demo-bar", { role: "Staff", time: "14:05" })).toBe("Demo · Signed in as Staff · Ends at 14:05");
    expect(t("id", "C-demo-bar", { role: "Staf", time: "14:05" })).toBe("Demo · Masuk sebagai Staf · Berakhir pukul 14:05");
    expect(t("en", "C-demo-switch", { role: "Owner" })).toBe("Switch to Owner");
  });

  it("never carries a raw IP, key or template word in the copy", () => {
    for (const key of DEMO_KEYS) {
      expect(EN[key]).not.toMatch(/sandbox|demo-tpl|sbx-/i);
    }
  });
});

/** R-18 P1: the official role sign-in (`C-signin-role-*`) and the demo credentials box (`C-demo-cred-*`). All PROVISIONAL. */
const SIGNIN_ROLE_KEYS = [
  "C-signin-as",
  "C-signin-role-staff",
  "C-signin-role-supervisor",
  "C-signin-role-owner",
  "C-signin-choose",
  "C-signin-staff-help",
  "C-signin-staff-connected",
] as const satisfies readonly DictKey[];

const DEMO_CRED_KEYS = [
  "C-demo-cred-title",
  "C-demo-cred-code",
  "C-demo-cred-email",
  "C-demo-cred-password",
  "C-demo-cred-fill",
  "C-demo-cred-filled",
  "C-demo-cred-private",
  "C-demo-cred-continuing",
  "C-demo-cred-fresh",
] as const satisfies readonly DictKey[];

describe("R-18 P1 role sign-in and demo credential copy", () => {
  it("defines every key in both languages, non-empty", () => {
    for (const key of [...SIGNIN_ROLE_KEYS, ...DEMO_CRED_KEYS]) {
      expect(ID[key]?.trim().length, `ID ${key}`).toBeGreaterThan(0);
      expect(EN[key]?.trim().length, `EN ${key}`).toBeGreaterThan(0);
    }
  });

  it("uses the agreed wording", () => {
    expect(EN["C-signin-staff-help"]).toBe("Enter the 6-digit code from your supervisor to connect this phone.");
    expect(ID["C-signin-staff-help"]).toBe("Masukkan kode 6 angka dari supervisor untuk menghubungkan ponsel ini.");
    expect(EN["C-demo-cred-private"]).toBe(
      "Each sign-in opens your own private copy of a fictional shop for 2 hours. Nothing you do affects anyone else.",
    );
    expect(ID["C-demo-cred-private"]).toBe(
      "Setiap masuk membuka salinan pribadi toko fiktif selama 2 jam. Yang Anda lakukan tidak memengaruhi orang lain.",
    );
    expect(EN["C-demo-path"]).toBe(
      "Suggested path: sign in as Staff and speak a short shop day, answer the debrief, then switch to Supervisor and Owner from the bar at the top.",
    );
    expect(EN["C-signin-role-staff"]).toBe("Staff");
    expect(ID["C-signin-role-staff"]).toBe("Staf");
    expect(ID["C-signin-role-owner"]).toBe("Pemilik");
  });

  it("fills the continuing placeholder", () => {
    expect(t("en", "C-demo-cred-continuing", { time: "14:05" })).toContain("14:05");
    expect(t("id", "C-demo-cred-continuing", { time: "14:05" })).toContain("14:05");
  });

  it("the word Try is gone from the demo sign-in labels and the old Try-as keys no longer exist", () => {
    for (const key of [...SIGNIN_ROLE_KEYS, ...DEMO_CRED_KEYS, "C-demo-path", "C-demo-bar", "C-demo-restart"] as const) {
      expect(EN[key], `EN ${key}`).not.toMatch(/\btry\b/i);
      expect(ID[key], `ID ${key}`).not.toMatch(/\bcoba\b/i);
    }
    expect(Object.keys(EN).filter((k) => k.startsWith("C-demo-try-"))).toEqual([]);
    expect(Object.keys(ID).filter((k) => k.startsWith("C-demo-try-"))).toEqual([]);
  });

  it("never carries a credential value: those live only in lib/demo/credentials.ts", () => {
    for (const key of [...SIGNIN_ROLE_KEYS, ...DEMO_CRED_KEYS]) {
      for (const text of [EN[key], ID[key]]) expect(text).not.toMatch(/000000|bee6-demo|judge@example\.com/);
    }
    const source = readFileSync(join(__dirname, "dict.ts"), "utf8");
    expect(source).not.toMatch(/000000|bee6-demo|judge@example\.com/);
  });
});
