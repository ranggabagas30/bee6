import { describe, expect, it } from "vitest";
import { EN, ID } from "@/lib/i18n/dict";
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

  it("the dictionary's size is its own keys plus every slice's (a spread never silently replaces an existing key)", () => {
    const sliceKeys = Object.values(SLICES).reduce((n, { id }) => n + Object.keys(id).length, 0);
    const lib = Object.keys(ID).length;
    expect(lib).toBeGreaterThanOrEqual(sliceKeys);
    expect(Object.keys(EN).length).toBe(lib);
  });
});
