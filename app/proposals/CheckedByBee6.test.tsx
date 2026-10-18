// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CheckedByBee6 } from "@/app/proposals/CheckedByBee6";
import type { ProposalView } from "@/lib/proposals/contract";
import { axeViolations } from "@/lib/testing/axe";

afterEach(() => cleanup());

type Checked = NonNullable<ProposalView["checked"]>;
const V3: Checked = { checks_total: 8, checks_passed: 8, rule_set: "pgate-v1", agent: "proposal-v3", revisions: 0, read_sections: null, read_facts: null };
const V4: Checked = { checks_total: 18, checks_passed: 18, rule_set: "pcheck-v4", agent: "proposal-v4", revisions: 1, read_sections: 1, read_facts: 2 };

describe("CheckedByBee6 (CHK-1), full variant (supervisor detail)", () => {
  it("v3: the kicker counts the checks, the code line says they are fixed rules; no agent-reads line, no revision line", () => {
    render(<CheckedByBee6 lang="en" checked={V3} variant="full" />);
    expect(screen.getByText("CHECKED BY BEE6 · 8 OF 8 CHECKS")).not.toBeNull();
    expect(screen.getByText("Every check is a fixed rule in code, not the model's opinion.")).not.toBeNull();
    expect(screen.queryByText(/The agent read/)).toBeNull();
    expect(screen.queryByText(/Revised/)).toBeNull();
  });

  it("v4: adds the line with the section and fact counts and, after a revision, the revision line", () => {
    render(<CheckedByBee6 lang="en" checked={V4} variant="full" />);
    expect(screen.getByText("CHECKED BY BEE6 · 18 OF 18 CHECKS")).not.toBeNull();
    expect(screen.getByText("The agent read 1 SOP section(s) and 2 fact(s) before writing.")).not.toBeNull();
    expect(screen.getByText("Revised 1 time(s) until every check passed.")).not.toBeNull();
  });

  it("v4 that passed first time: the reads line, no revision line", () => {
    render(<CheckedByBee6 lang="en" checked={{ ...V4, revisions: 0 }} variant="full" />);
    expect(screen.getByText(/The agent read 1 SOP section/)).not.toBeNull();
    expect(screen.queryByText(/Revised/)).toBeNull();
  });

  it("a v3 revision shows the revision line without the reads line", () => {
    render(<CheckedByBee6 lang="en" checked={{ ...V3, revisions: 1 }} variant="full" />);
    expect(screen.getByText("Revised 1 time(s) until every check passed.")).not.toBeNull();
    expect(screen.queryByText(/The agent read/)).toBeNull();
  });

  it("a partial count reads as plain text ('7 OF 8'): no colour word, no icon", () => {
    const { container } = render(<CheckedByBee6 lang="en" checked={{ ...V3, checks_passed: 7 }} variant="full" />);
    expect(screen.getByText("CHECKED BY BEE6 · 7 OF 8 CHECKS")).not.toBeNull();
    expect(container.querySelector("svg, img")).toBeNull();
  });

  it("ID copy (provisional)", () => {
    render(<CheckedByBee6 lang="id" checked={V4} variant="full" />);
    expect(screen.getByText("DIPERIKSA BEE6 · 18 DARI 18 PEMERIKSAAN")).not.toBeNull();
    expect(screen.getByText("Setiap pemeriksaan adalah aturan tetap dalam kode, bukan pendapat model.")).not.toBeNull();
    expect(screen.getByText("Agen membaca 1 bagian SOP dan 2 fakta sebelum menulis.")).not.toBeNull();
    expect(screen.getByText("Direvisi 1 kali sampai semua pemeriksaan lolos.")).not.toBeNull();
  });

  it("renders nothing for null or undefined (a suppressed doc, or a response that predates CHK-1)", () => {
    const a = render(<CheckedByBee6 lang="en" checked={null} variant="full" />);
    expect(a.container.innerHTML).toBe("");
    const b = render(<CheckedByBee6 lang="en" checked={undefined} variant="full" />);
    expect(b.container.innerHTML).toBe("");
  });

  it("is a named section landmark with no list and no heading (it must not disturb the page's outline)", () => {
    const { container } = render(<CheckedByBee6 lang="en" checked={V4} variant="full" />);
    const region = screen.getByRole("region", { name: "CHECKED BY BEE6 · 18 OF 18 CHECKS" });
    expect(region.tagName).toBe("SECTION");
    expect(container.querySelector("ul, ol, h1, h2, h3, h4")).toBeNull();
  });

  it("has no axe violations (EN and ID, with every line)", async () => {
    const en = render(<CheckedByBee6 lang="en" checked={V4} variant="full" />);
    expect(await axeViolations(en.container)).toEqual([]);
    en.unmount();
    const id = render(<CheckedByBee6 lang="id" checked={V4} variant="full" />);
    expect(await axeViolations(id.container)).toEqual([]);
  });
});

describe("CheckedByBee6 (CHK-1), short variant (owner card)", () => {
  it("the kicker and the code line only, even on a v4 doc with revisions", () => {
    render(<CheckedByBee6 lang="en" checked={V4} variant="short" />);
    expect(screen.getByText("CHECKED BY BEE6 · 18 OF 18 CHECKS")).not.toBeNull();
    expect(screen.getByText("Every check is a fixed rule in code, not the model's opinion.")).not.toBeNull();
    expect(screen.queryByText(/The agent read/)).toBeNull();
    expect(screen.queryByText(/Revised/)).toBeNull();
  });

  it("renders nothing for null", () => {
    const { container } = render(<CheckedByBee6 lang="en" checked={null} variant="short" />);
    expect(container.innerHTML).toBe("");
  });
});

describe("CheckedByBee6 (CHK-1), 360 px", () => {
  const css = readFileSync(join(__dirname, "checked.module.css"), "utf8");
  const block = (selector: string) => {
    const start = css.indexOf(selector);
    return start < 0 ? "" : css.slice(start, css.indexOf("}", start) + 1);
  };

  it("long lines wrap (overflow-wrap anywhere) and the card can shrink; nothing is pinned to a pixel width", () => {
    expect(block(".line {")).toMatch(/overflow-wrap:\s*anywhere/);
    expect(block(".kicker {")).toMatch(/overflow-wrap:\s*anywhere/);
    expect(block(".card {")).toMatch(/min-width:\s*0/);
    expect(css).not.toMatch(/(^|[^-])width:\s*\d+px/m);
    expect(css).not.toMatch(/white-space:\s*nowrap/);
  });
});
