# R-P1 ruling: discard response status (tech-lead, 7 Oct)

**Ruling: (b).** P1 keeps `202 { ok: true, cleanup: "pending" }` on every successful discard. Amend
`docs/specs/web-backend-rbac.md` §6.6.5 so it says this until Cancel-B ships.

Reasons:
1. The premise behind (a) is false. On `02dc564` the R-05b tick and label pipeline
   (`app/api/internal/pipeline/tick/route.ts`, `lib/pipeline/label/*`, `lib/firestore/tick-store.ts`)
   is already present. Segments processed before the discard can already have threads, label units
   or ledger entries, and P1 deletes none of them. Answering "done" would be false.
2. Per §6.6.5, "done" means the tombstone's `cleanup_done_at_ms` is set. P1 leaves it `null`, so a 202
   "pending" matches what is stored, and Cancel-B's tick query will pick these tombstones up later.
3. The phone treats 200 and 202 the same, so (b) changes no client behaviour. It only makes the spec
   match the code, and it adds no new route condition that Cancel-B would have to undo.

No code change. The route already does this, and its header comment is correct.
Spec amendment for §6.6.5's Response bullet: "Until Cancel-B ships (P1), every successful
discard answers 202 `cleanup: "pending"` and leaves `cleanup_done_at_ms: null`. The 200/202 split
above applies once Cancel-B exists."
