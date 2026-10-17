import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * /pair and the demo entry page cancel the browser's default body margin for their own page only (R-19 PR-6). A negative
 * margin on `.page` would pull it under the root layout's DemoBar, and a global reset is out of scope. (The owner Home left
 * this list in R-25 T13: it now lives inside `WebShell`, whose own sheet resets the margin: see shell-css.test.ts.)
 */
const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("page ground CSS", () => {
  for (const rel of ["app/pair/pair.module.css", "app/web/entry.module.css"]) {
    it(`${rel} scopes the body-margin reset to the page and uses no negative margin`, () => {
      const css = read(rel);
      expect(css).toContain(":global(body):has(.page)");
      expect(css).toMatch(/:global\(body\):has\(\.page\)\s*{\s*margin:\s*0;/);
      expect(css).not.toMatch(/margin:\s*-8px/);
      expect(css).toMatch(/min-height:\s*100dvh/);
    });
  }

  it("globals.css gets no global body reset from these pages", () => {
    expect(read("app/globals.css")).not.toMatch(/:has\(\.page\)/);
  });
});
