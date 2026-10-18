import { describe, expect, it } from "vitest";
import { EN, EN_BASE, ID, ID_BASE } from "@/lib/i18n/dict";
import { clashingKeys } from "@/lib/i18n/v2/clash";
import * as journey from "@/lib/i18n/v2/journey";
import * as session from "@/lib/i18n/v2/session";
import * as debrief from "@/lib/i18n/v2/debrief";
import * as web from "@/lib/i18n/v2/web";
import * as proposals from "@/lib/i18n/v2/proposals";
import * as devices from "@/lib/i18n/v2/devices";
import * as sop from "@/lib/i18n/v2/sop";
import * as home from "@/lib/i18n/v2/home";

/**
 * R-19 PR-0: the i18n v2 split. Each later PR adds copy only in its own slice file; dict.ts spreads every
 * slice once into ID and EN. These tests keep a slice from drifting (same keys in both languages, same
 * placeholders), from colliding with another slice or with an existing key, and from being left out of the
 * dictionary.
 */
const SLICES: Record<string, { id: Record<string, string>; en: Record<string, string> }> = {
  journey: { id: journey.journeyID, en: journey.journeyEN },
  session: { id: session.sessionID, en: session.sessionEN },
  debrief: { id: debrief.debriefID, en: debrief.debriefEN },
  web: { id: web.webID, en: web.webEN },
  proposals: { id: proposals.proposalsID, en: proposals.proposalsEN },
  devices: { id: devices.devicesID, en: devices.devicesEN },
  sop: { id: sop.sopID, en: sop.sopEN },
  home: { id: home.homeID, en: home.homeEN },
};

const placeholders = (text: string) =>
  [...text.matchAll(/\{([a-zA-Z_]+)\}/g)].map((m) => m[1]).sort().join(",");

describe("i18n v2 slices", () => {
  it("has the eight planned slices", () => {
    expect(Object.keys(SLICES).sort()).toEqual(["debrief", "devices", "home", "journey", "proposals", "session", "sop", "web"]);
  });

  for (const [name, { id, en }] of Object.entries(SLICES)) {
    describe(name, () => {
      it("has identical key sets in ID and EN", () => {
        expect(Object.keys(en).sort()).toEqual(Object.keys(id).sort());
      });

      it("has non-empty, trimmed values with the same placeholders in both languages", () => {
        for (const key of Object.keys(id)) {
          expect(id[key]!.trim().length, `ID ${key}`).toBeGreaterThan(0);
          expect(en[key]!.trim().length, `EN ${key}`).toBeGreaterThan(0);
          expect(id[key], `ID ${key}`).toBe(id[key]!.trim());
          expect(en[key], `EN ${key}`).toBe(en[key]!.trim());
          expect(placeholders(en[key]!), key).toBe(placeholders(id[key]!));
        }
      });

      it("is spread into the dictionary with the same values", () => {
        for (const key of Object.keys(id)) {
          expect((ID as Record<string, string>)[key], `ID ${key}`).toBe(id[key]);
          expect((EN as Record<string, string>)[key], `EN ${key}`).toBe(en[key]);
        }
      });
    });
  }

  it("no key is defined in two slices", () => {
    const seen = new Map<string, string>();
    for (const [name, { id }] of Object.entries(SLICES)) {
      for (const key of Object.keys(id)) {
        expect(seen.has(key), `${key} is in both ${seen.get(key)} and ${name}`).toBe(false);
        seen.set(key, name);
      }
    }
  });

  describe("a slice never replaces a base key", () => {
    it("clashingKeys names every key a slice shares with the base or with an earlier slice", () => {
      expect(clashingKeys({ a: "1", b: "2" }, { s1: { c: "3" }, s2: { b: "x", d: "4" } })).toEqual(["b (s2)"]);
      expect(clashingKeys({ a: "1" }, { s1: { c: "3" }, s2: { c: "x" } })).toEqual(["c (s2)"]);
      expect(clashingKeys({ a: "1" }, { s1: { c: "3" }, s2: { d: "x" } })).toEqual([]);
    });
    it("no slice key is already in ID_BASE or EN_BASE (so a spread replaces nothing)", () => {
      const ids = Object.fromEntries(Object.entries(SLICES).map(([n, { id }]) => [n, id]));
      const ens = Object.fromEntries(Object.entries(SLICES).map(([n, { en }]) => [n, en]));
      expect(clashingKeys(ID_BASE, ids)).toEqual([]);
      expect(clashingKeys(EN_BASE, ens)).toEqual([]);
    });
    it("the dictionary is exactly the base plus every slice, in both languages", () => {
      const sliceKeys = Object.values(SLICES).reduce((n, { id }) => n + Object.keys(id).length, 0);
      expect(Object.keys(ID).length).toBe(Object.keys(ID_BASE).length + sliceKeys);
      expect(Object.keys(EN).length).toBe(Object.keys(EN_BASE).length + sliceKeys);
    });
  });

  describe("the Preparing hint is valid with and without the DebriefAgent (UI-009)", () => {
    const KEYS = ["C-d2-prep-1", "C-d2-prep-sub"] as const;

    it("names both steps (reading the notes, writing the questions) in EN and ID, and admits the wait can run long", () => {
      const en = debrief.debriefEN as Record<string, string>;
      const id = debrief.debriefID as Record<string, string>;
      for (const key of KEYS) {
        expect(en[key], key).toContain("Bee6 is reading today's notes and writing your questions.");
        expect(en[key], key).toContain("a little longer");
        expect(id[key], key).toContain("Bee6 sedang membaca catatan hari ini dan menyusun pertanyaanmu.");
        expect(id[key], key).toContain("sedikit lebih lama");
      }
    });

    it("no longer says the notes are read only to decide what to ask (that is untrue once an agent words the question)", () => {
      for (const key of KEYS) {
        expect((debrief.debriefEN as Record<string, string>)[key]).not.toContain("decide what to ask");
        expect((debrief.debriefID as Record<string, string>)[key]).not.toContain("menentukan apa yang perlu ditanyakan");
      }
    });
  });
});
