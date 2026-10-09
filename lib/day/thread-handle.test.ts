import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { openThreadHandle, readThreadHandleKey, sealThreadHandle } from "@/lib/day/thread-handle";

const KEY = randomBytes(32);
const OUTLET = "outlet-1";
const OTHER_OUTLET = "outlet-2";
const THREAD_ID = "unit_demo-phone_w_seg123:0";

describe("thread-handle", () => {
  describe("readThreadHandleKey", () => {
    it("32-byte base64 -> a 32-byte Buffer", () => {
      const key = readThreadHandleKey({ THREAD_HANDLE_KEY: KEY.toString("base64") });
      expect(key).not.toBeNull();
      expect(key?.length).toBe(32);
      expect(key?.equals(KEY)).toBe(true);
    });

    it("16-byte base64 -> null (wrong length)", () => {
      const short = randomBytes(16).toString("base64");
      expect(readThreadHandleKey({ THREAD_HANDLE_KEY: short })).toBeNull();
    });

    it("missing -> null", () => {
      expect(readThreadHandleKey({})).toBeNull();
    });

    it("not base64 -> null", () => {
      expect(readThreadHandleKey({ THREAD_HANDLE_KEY: "!!! not base64 !!!" })).toBeNull();
    });

    it("empty string -> null", () => {
      expect(readThreadHandleKey({ THREAD_HANDLE_KEY: "" })).toBeNull();
    });
  });

  describe("sealThreadHandle / openThreadHandle", () => {
    it("round trips", () => {
      const handle = sealThreadHandle(THREAD_ID, OUTLET, KEY);
      expect(openThreadHandle(handle, OUTLET, KEY)).toBe(THREAD_ID);
    });

    it("the handle does not contain the thread id or the device id substring", () => {
      const handle = sealThreadHandle(THREAD_ID, OUTLET, KEY);
      expect(handle).not.toContain(THREAD_ID);
      expect(handle).not.toContain("demo-phone");
      expect(handle).not.toContain("unit_");
    });

    it("two seals of the same id differ (random iv)", () => {
      const a = sealThreadHandle(THREAD_ID, OUTLET, KEY);
      const b = sealThreadHandle(THREAD_ID, OUTLET, KEY);
      expect(a).not.toBe(b);
      // both still open back to the same thread id
      expect(openThreadHandle(a, OUTLET, KEY)).toBe(THREAD_ID);
      expect(openThreadHandle(b, OUTLET, KEY)).toBe(THREAD_ID);
    });

    it("wrong outlet -> null", () => {
      const handle = sealThreadHandle(THREAD_ID, OUTLET, KEY);
      expect(openThreadHandle(handle, OTHER_OUTLET, KEY)).toBeNull();
    });

    it("one flipped character -> null", () => {
      const handle = sealThreadHandle(THREAD_ID, OUTLET, KEY);
      const chars = handle.split("");
      // Flip a character in the middle (inside the ciphertext/tag region),
      // swapping to something guaranteed different and still base64url-safe.
      const i = Math.floor(chars.length / 2);
      chars[i] = chars[i] === "A" ? "B" : "A";
      const tampered = chars.join("");
      expect(openThreadHandle(tampered, OUTLET, KEY)).toBeNull();
    });

    it.each(["", "a", "!".repeat(10), "A".repeat(600)])("malformed input %j -> null", (bad) => {
      expect(openThreadHandle(bad, OUTLET, KEY)).toBeNull();
    });

    it("wrong key -> null", () => {
      const handle = sealThreadHandle(THREAD_ID, OUTLET, KEY);
      const otherKey = randomBytes(32);
      expect(openThreadHandle(handle, OUTLET, otherKey)).toBeNull();
    });
  });
});
