# UX-03 new copy keys (6 Oct, for lib/i18n/dict.ts)

Source: `docs/tasks/UX-03-journey-design.md` section 6. Written by UI/UX 6 Oct, approved by Rangga (delegated).
Every line is at most 59 characters in both columns (checked by script). Single line per key, no placeholders.
The existing 131 keys are approved (Rangga, 6 Oct) and already in the sheet; add only the keys below to the dictionary
in this round.

Where each key shows: under upload block row 1 (`C-u-retry`) and row 1a (`C-u-server`) on `/capture`, in the polite
upload-block region (section 5.7). No new live-region announcement.

| key | ID | EN |
|---|---|---|
| C-u-retry-help | Terkirim sendiri saat HP bisa menjangkau server. | It sends by itself once the phone can reach the server. |
| C-u-server-help | Akan dicoba lagi sendiri. Tidak perlu tindakan. | It will try again on its own. No action needed. |
| C-u-lost-help | Catatan itu jadi tidak lengkap. Tidak bisa dipulihkan. | That note is now incomplete. It cannot be recovered. |

Count: 3 new keys (decision F, 6 Oct, decided by UI/UX; tech-lead feasibility answer pending). 131 existing keys approved (Approved by Rangga 6 Oct).

## Decided 7 Oct (Decided by UI/UX, 7 Oct)

- `C-u-lost-help`: wording final, no change. ID "Catatan itu jadi tidak lengkap. Tidak bisa dipulihkan." (54 characters) / EN "That note is now incomplete. It cannot be recovered." (52 characters). Matches UX-03 §6 and §5.7.
- Upload block is one `role="status"` region (UX-03 §5.7, option b). The helper is read, not `aria-hidden`.

## Added 7 Oct (Written by UI/UX 7 Oct, delegated to UI/UX by Rangga)

| key | ID | EN | Reason |
|---|---|---|---|
| C-h-idle-help | Ketuk Mulai untuk memulai sesi hari ini. | Tap Start to begin today's session. | Under "Belum mulai / Not started" before capture runs. Names the one action. Shown only when Mulai is offered; otherwise the Mulai reason note. No "Mendengarkan" (the positive state word is reserved for `listening`). |
| C-u-inet | Tidak ada internet. Sambungkan agar antrean terkirim. | No internet. Connect so the queued items can send. | Upload-block detail when the browser reports no connection. One next step (connect). "Antrean" and "queued items" match C-u-lost-qfull-act and the queue wording. Audio words avoided. |

Count: 2 keys added. Sheet total 133 (131 approved + 2). Every line checked at 59 characters or fewer in both columns
(new lines: 35 to 53 characters).

Capture privacy notice: no new key added. The approved final line (§12 / Q-U24) is already in the sheet as
`C-notice-demo-1` to `C-notice-demo-6` (demo outlet; EN and ID, approved 6 Oct) and `C-notice-pilot` (pilot). Reuse unchanged.
Not added: no new privacy wording. The formal technical spec §8.16 sign-off is still open.

Open for Rangga, not written: the retention periods in the demo notice (24 h, 14 days) differ from the history copy
in §5.9 and are flagged in UX-03 §0 for the tech-lead to confirm (technical spec wins); C-u-inet's "connect" next step
assumes a connection can be restored by the staff member.
Where `C-u-lost-help` shows: under the lost value on the upload block (section 5.7 row L), P1 and later. Not a live-region announcement.

Not written (no copy key, reason):
- Selesai and Lanjut in-flight busy labels, Selesai double-tap guard: the doc names no such state (only Mulai has
  `C-b-mulai-busy`). Add only if the tech-lead or Rangga defines the state.
- ID debrief category labels (11 codes, Q-U23): still pending Rangga. The question falls back to `C-d-q-block`
  in ID until they exist (section 5.12.3).
- Formal privacy notice sign-off (technical spec §8.16): not a copy question; still open before the pilot page.
