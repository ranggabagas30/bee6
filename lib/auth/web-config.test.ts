import { describe, expect, it } from "vitest";
import { readFirebaseWebConfig } from "@/lib/auth/web-config";

/**
 * R-06 Task 4.1. Firebase web config is read from `process.env` at request
 * time (not baked at build time, cloudbuild.yaml's no-baked-values rule) and
 * handed to the client as a prop. Any missing/empty value must yield `null`,
 * never throw — a misconfigured server shows a message, not a 500.
 */

const FULL_ENV = {
  FIREBASE_API_KEY: "key-1",
  FIREBASE_AUTH_DOMAIN: "proj.firebaseapp.com",
  FIREBASE_PROJECT_ID: "proj",
  FIREBASE_APP_ID: "1:1:web:abc",
};

describe("readFirebaseWebConfig", () => {
  it("returns the config object when all four vars are set", () => {
    expect(readFirebaseWebConfig(FULL_ENV)).toEqual({
      apiKey: "key-1",
      authDomain: "proj.firebaseapp.com",
      projectId: "proj",
      appId: "1:1:web:abc",
    });
  });

  it.each(Object.keys(FULL_ENV))("returns null when %s is missing", (key) => {
    const env = { ...FULL_ENV, [key]: undefined };
    expect(readFirebaseWebConfig(env)).toBeNull();
  });

  it.each(Object.keys(FULL_ENV))("returns null when %s is an empty string", (key) => {
    const env = { ...FULL_ENV, [key]: "" };
    expect(readFirebaseWebConfig(env)).toBeNull();
  });

  it("never throws on a completely empty env", () => {
    expect(() => readFirebaseWebConfig({})).not.toThrow();
    expect(readFirebaseWebConfig({})).toBeNull();
  });
});
