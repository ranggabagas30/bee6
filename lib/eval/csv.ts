/**
 * Minimal RFC-4180 CSV reader/writer for the R-13 eval scripts (no new dependency).
 * Handles quoted fields with commas, `""` escapes, embedded newlines, CRLF and a UTF-8 BOM.
 */

/** Parses CSV text into rows of cells. Fully blank lines are dropped. Throws on an unterminated quote. */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let cellStarted = false;

  const endCell = (): void => {
    row.push(cell);
    cell = "";
    cellStarted = false;
  };
  const endRow = (): void => {
    endCell();
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && !cellStarted) {
      inQuotes = true;
      cellStarted = true;
    } else if (ch === ",") {
      endCell();
    } else if (ch === "\n") {
      endRow();
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
    } else {
      cell += ch;
      cellStarted = true;
    }
  }
  if (inQuotes) throw new Error("CSV has an unterminated quoted field");
  if (cellStarted || cell !== "" || row.length > 0) endRow();
  return rows;
}

function escapeCell(cell: string): string {
  return /[",\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

/** Serialises rows to CSV text with `\n` row ends and a trailing newline. */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((r) => r.map(escapeCell).join(",")).join("\n") + "\n";
}
