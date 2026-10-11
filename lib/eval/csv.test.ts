import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "@/lib/eval/csv";

describe("parseCsv", () => {
  it("parses plain rows", () => {
    expect(parseCsv("a,b\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("handles a quoted field with an embedded comma and an escaped quote", () => {
    expect(parseCsv('a,b\n"x, ""y"" z",2')).toEqual([
      ["a", "b"],
      ['x, "y" z', "2"],
    ]);
  });

  it("handles an embedded newline inside quotes and CRLF row ends", () => {
    expect(parseCsv('a,b\r\n"line1\nline2",2\r\n')).toEqual([
      ["a", "b"],
      ["line1\nline2", "2"],
    ]);
  });

  it("strips a UTF-8 BOM and keeps empty cells", () => {
    expect(parseCsv("﻿a,b,c\n1,,3")).toEqual([
      ["a", "b", "c"],
      ["1", "", "3"],
    ]);
  });

  it("drops fully blank lines", () => {
    expect(parseCsv("a\n\n1\n")).toEqual([["a"], ["1"]]);
  });

  it("throws on an unterminated quote", () => {
    expect(() => parseCsv('a\n"oops')).toThrow(/unterminated/i);
  });
});

describe("toCsv", () => {
  it("quotes only the cells that need it and round-trips through parseCsv", () => {
    const rows = [
      ["episode", "lines"],
      ["E0001", 'said "hi", then left'],
      ["E0002", "plain"],
    ];
    const text = toCsv(rows);
    expect(text).toBe('episode,lines\nE0001,"said ""hi"", then left"\nE0002,plain\n');
    expect(parseCsv(text)).toEqual(rows);
  });
});
