/**
 * Fictional trap fixture for the label-model eval (R-05b, Task 7).
 *
 * Hard rule #8: this is entirely fictional, never real shop data —
 * `config/categories.draft.yaml` (which this eval reads) is public.
 *
 * Decision 1 (docs/tasks/R-05b.md): this fixture is written now so
 * `npm run eval:label` can run today for an early, informal signal.
 * Tiffany's real (fictional-paraphrase) examples land separately as a
 * config-only drop-in into `config/categories.yaml`'s `examples` — this
 * fixture does not depend on them and is not replaced by them.
 *
 * The trap: line 0 is a hypothetical "if we ever run out" discussion
 * (nothing live being handled — TRAINING), and line 2 is a REAL stock-out
 * a few lines later in the same conversation. A model that conflates the
 * hypothetical with the live event would mislabel line 0 as
 * CUSTOMER_SERVICE/ROUTINE_OPS instead of TRAINING.
 */

export interface TrapFixtureLine {
  id: string;
  text: string;
}

/** Index into TRAP_FIXTURE_LINES of the hypothetical line that must label TRAINING. */
export const TRAP_LINE_INDEX = 0;

export const TRAP_FIXTURE_LINES: TrapFixtureLine[] = [
  {
    id: "hypothetical",
    text:
      "Kalau nanti egg tart-nya habis, bilang aja ke customer kita masih ada croissant sama danish ya.",
  },
  { id: "filler", text: "Oke, dicatat." },
  {
    id: "real_stock_out",
    text: "Tadi ada customer tanya egg tart, saya bilang stoknya habis, akhirnya dia ambil croissant.",
  },
];
