import os, json, datetime
ROOT = "<LOCAL_PATH>/bee6/.claude/canvas-ux03"
P = os.path.join(ROOT, "project")

CSS = """@import url("https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap");
:root{--bg:#FAF7F2;--fg:#1F1D1A;--muted:#55514A;--accent:#0B5B57;--on-accent:#FFFFFF;--ok:#1E6B3A;--warn:#7A4F00;--danger:#A3262B;--on-danger:#FFFFFF;--focus:#1F4FD1;--surface:#FFFFFF;--line:#E9E4DA;color-scheme:light}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#17191C;--fg:#E8E6E1;--muted:#A9A49A;--accent:#8FD1C9;--on-accent:#0E2F2D;--ok:#7FD39A;--warn:#F0B861;--danger:#F28B8F;--on-danger:#3A0D0F;--focus:#5FA8D3;--surface:#22252A;--line:#3A3E45;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#17191C;--fg:#E8E6E1;--muted:#A9A49A;--accent:#8FD1C9;--on-accent:#0E2F2D;--ok:#7FD39A;--warn:#F0B861;--danger:#F28B8F;--on-danger:#3A0D0F;--focus:#5FA8D3;--surface:#22252A;--line:#3A3E45;color-scheme:dark}
body{margin:0;background:var(--bg);color:var(--fg);font-family:"Atkinson Hyperlegible",system-ui,-apple-system,"Segoe UI",sans-serif;font-size:16px;line-height:24px}
*:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
.screen{box-sizing:border-box;width:360px;padding:16px;display:flex;flex-direction:column;gap:16px;background:var(--bg)}
.h1{display:block;font-size:28px;line-height:34px;font-weight:700;text-wrap:balance}
.h2{display:block;font-size:20px;line-height:26px;font-weight:700}
.en{display:block;color:var(--muted);font-size:14px;line-height:20px}
.note{margin:0;color:var(--muted)}
.note .en,.copy .en{margin-top:2px}
.headline{display:flex;gap:12px;align-items:flex-start}
.headline .ic{width:28px;height:28px;flex:none;margin-top:4px}
.tone-ok .h1{color:var(--ok)} .tone-ok .ic{color:var(--ok)}
.tone-warn .h1{color:var(--warn)} .tone-warn .ic{color:var(--warn)}
.tone-danger .h1{color:var(--danger)} .tone-danger .ic{color:var(--danger)}
.tone-muted .h1{color:var(--fg)} .tone-muted .ic{color:var(--muted)}
.ic{display:inline-block}
.slot{display:flex;flex-direction:column;gap:8px;min-height:56px;justify-content:center}
.btn{display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;min-height:48px;box-sizing:border-box;padding:8px 16px;border-radius:12px;border:1px solid transparent;font-family:inherit;font-size:18px;font-weight:700;line-height:24px;text-align:center;cursor:pointer}
.btn-primary{min-height:56px;background:var(--accent);color:var(--on-accent)}
.btn-secondary{background:var(--surface);color:var(--fg);border-color:var(--line)}
.btn-danger{background:var(--danger);color:var(--on-danger)}
.btn .en{display:inline;font-size:14px;font-weight:400;color:inherit;opacity:.92}
.btn[aria-disabled="true"]{background:var(--surface);color:var(--muted);border:1px dashed var(--muted)}
.btn-row{display:flex;gap:12px}
.btn-row>.btn{flex:1}
.card{box-sizing:border-box;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:12px}
.lbl{display:block;font-weight:700;margin-bottom:8px}
.code{box-sizing:border-box;width:100%;min-height:56px;padding:8px 12px;border:2px solid var(--muted);border-radius:8px;background:var(--surface);color:var(--fg);font-family:inherit;font-size:24px;font-weight:700;letter-spacing:.2em;font-variant-numeric:tabular-nums}
.code[aria-invalid="true"]{border-color:var(--danger)}
.alert{margin:0;color:var(--danger);font-weight:700}
.notice{margin:0;font-size:14px;line-height:20px;color:var(--muted)}
.conflict{margin:0;padding:8px 12px;border:2px dashed var(--warn);border-radius:8px;background:var(--surface);color:var(--fg);font-size:14px;line-height:20px}
.conflict b{color:var(--warn)}
.guess{margin:0;padding:8px 12px;border:1px dotted var(--muted);border-radius:8px;font-size:14px;line-height:20px;color:var(--muted)}
.steps{margin:0;padding-left:24px;display:flex;flex-direction:column;gap:12px}
.steps li span{display:block}
.line-status{display:flex;gap:8px;align-items:flex-start;margin:0}
.line-status .ic{width:20px;height:20px;flex:none;margin-top:4px}
.sub{margin:0 0 0 28px}
.row-tag{font-size:14px;color:var(--muted);font-weight:700}
.choice{display:flex;gap:12px}
.choice button{flex:1;min-height:48px;border-radius:12px;border:2px solid var(--muted);background:var(--surface);color:var(--fg);font-family:inherit;font-size:18px;font-weight:700}
.choice button[aria-checked="true"]{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}
.reason{box-sizing:border-box;width:100%;min-height:96px;padding:8px 12px;border:2px solid var(--muted);border-radius:8px;background:var(--surface);color:var(--fg);font-family:inherit;font-size:16px;line-height:24px}
.counter{text-align:right;font-variant-numeric:tabular-nums;color:var(--muted);font-size:14px}
.counter.warn{color:var(--warn);font-weight:700}
.muted-block{height:56px;border-radius:12px;background:var(--line)}
.tablewrap{overflow-x:auto}
table{border-collapse:collapse;font-size:14px;line-height:20px;width:100%}
th,td{padding:8px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line)}
.grp{box-sizing:border-box;border:1px solid var(--line);border-radius:12px;padding:16px;background:var(--surface);display:flex;flex-direction:column;gap:12px}
.tag{font-size:14px;color:var(--muted);font-weight:700}
.toast{border-radius:12px;padding:8px 12px;background:var(--surface);border:1px solid var(--ok)}
"""

ICONS = {
 'spin': '<path d="M21 12a9 9 0 1 1-6.2-8.55"/>',
 'alert': '<path d="M12 3 2 21h20L12 3z"/><path d="M12 10v5M12 18h.01"/>',
 'idle': '<circle cx="12" cy="12" r="8"/>',
 'dot': '<circle cx="12" cy="12" r="6" fill="currentColor"/>',
 'x': '<path d="M6 6l12 12M18 6 6 18"/>',
 'stop': '<rect x="6" y="6" width="12" height="12" fill="currentColor"/>',
 'check': '<path d="M5 12.5 10 17 19 7"/>',
}
def ic(n):
    return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICONS[n] + '</svg>'

HL = {
 'loading': ('spin', 'Memuat…', 'Loading…', 'muted'),
 'error': ('alert', 'Pengaturan jam belum termuat', 'Hours not loaded yet', 'danger'),
 'unsupported': ('alert', 'Browser ini tidak bisa mendengarkan', "This browser can't listen", 'danger'),
 'tab_busy': ('alert', 'Halaman ini sudah terbuka di tab lain', 'This page is open in another tab', 'warn'),
 'idle': ('idle', 'Belum mulai', 'Not started', 'muted'),
 'listening': ('dot', 'Mendengarkan', 'Listening', 'ok'),
 'queue_full': ('alert', 'Mendengarkan · antrean penuh, rekaman lama terhapus', 'Listening · queue full, older audio dropped', 'warn'),
 'mic_error': ('x', 'Mikrofon bermasalah', 'Microphone problem', 'danger'),
 'stalled': ('x', 'Tidak mendengarkan · mencoba lagi', 'Not listening · retrying', 'danger'),
 'interrupted': ('alert', 'Tidak mendengarkan · sesi masih terbuka. Ketuk Lanjutkan', 'Not listening · session still open. Tap Lanjutkan', 'warn'),
 'ended': ('stop', 'Selesai', 'Ended', 'muted'),
 'ended_auto': ('stop', 'Selesai otomatis pukul 22:00', 'Ended automatically at 22:00', 'muted'),
 'discarded': ('stop', 'Sesi dibatalkan', 'Session cancelled', 'muted'),
}
def hl(key):
    i, idt, en, tone = HL[key]
    return '<div class="headline tone-' + tone + '" role="status">' + ic(i) + '<div><span class="h1" lang="id">' + idt + '</span><span class="en" lang="en">' + en + '</span></div></div>'

def bi(idt, en, tag='p', cls=''):
    c = (' class="' + cls + '"') if cls else ''
    return '<' + tag + c + '><span lang="id">' + idt + '</span><span class="en" lang="en">' + en + '</span></' + tag + '>'

def note(idt, en):
    return '<p class="note"><span lang="id">' + idt + '</span><span class="en" lang="en">' + en + '</span></p>'

def btn(idt, en, kind='primary', attrs=''):
    return '<button class="btn btn-' + kind + '" type="button"' + (' ' + attrs if attrs else '') + '><span lang="id">' + idt + '</span> <span class="en" lang="en">/ ' + en + '</span></button>'

def conf(c, text):
    return '<aside class="conflict"><b>Konflik ' + c + ' · terbuka, belum diputuskan / Conflict ' + c + ' · open, not decided.</b> ' + text + '</aside>'

def guess(text):
    return '<p class="guess">[guess] ' + text + '</p>'

def uline(icon, idt, en, tone):
    return '<p class="line-status tone-' + tone + '">' + ic(icon) + '<span><span lang="id">' + idt + '</span><span class="en" lang="en">' + en + '</span></span></p>'

NOTICE = '<p class="notice"><span lang="id">Suara tidak disimpan di cloud. Hanya catatan kerja yang disimpan.</span><span class="en" lang="en">Audio is not stored in the cloud. Only work notes are kept.</span></p>'

def capture(state, note_html, slot, secondary, upload, extra=''):
    return ('<main class="screen" lang="id">' + hl(state) + note_html + '<div class="slot">' + slot + '</div>'
            + secondary + '<div role="status">' + upload + '</div>' + extra + NOTICE + '</main>')

def pair(inner):
    return '<main class="screen" lang="id">' + inner + '</main>'

HELPER_PAIR = bi('Masukkan 6 digit kode dari orang yang memasang alat ini.', 'Enter the 6-digit code from the person who set up this phone.', 'p', 'note')
def code_field(value, invalid=False, err_id=None):
    inv = ' aria-invalid="true" aria-describedby="' + err_id + '"' if invalid else ''
    return ('<div><label for="code" class="lbl">Kode pemasangan / Pairing code</label>'
            '<input id="code" class="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" value="' + value + '"' + inv + '></div>')

BOARDS = []  # (key, title, w, h, html, preview_w)

# 1 pair entry
BOARDS.append(('Main.dc.html', 'Pair: entry', 360, 780, pair(
    bi('Pasang perangkat ini', 'Pair this device', 'h1', 'h1') + HELPER_PAIR
    + code_field('') + '<p class="note" id="code-help"><span lang="id">Isi 6 digit untuk melanjutkan.</span><span class="en" lang="en">Enter 6 digits to continue.</span></p>'
    + btn('Pasang', 'Pair', 'primary', 'aria-disabled="true"')
    + conf('C9', 'Bahasa di layar dengan terjemahan Inggris pada baris kedua. Apakah kedua baris tetap tampil di HP toko?')
)))

# 2 refused
BOARDS.append(('pair-refused.dc.html', 'Pair: code refused', 360, 780, pair(
    bi('Pasang perangkat ini', 'Pair this device', 'h1', 'h1') + HELPER_PAIR
    + '<div><label for="code" class="lbl">Kode pemasangan / Pairing code</label><input id="code" class="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" value="482019" aria-invalid="true" aria-describedby="code-err"></div>'
    + '<p id="code-err" role="alert" class="alert"><span lang="id">Kode tidak dikenali atau sudah dipakai. Minta kode baru.</span><span class="en" lang="en">Code not recognised or already used. Ask for a new code.</span></p>'
    + btn('Pasang', 'Pair', 'primary')
)))

# 3 network
BOARDS.append(('pair-network.dc.html', 'Pair: network error', 360, 780, pair(
    bi('Pasang perangkat ini', 'Pair this device', 'h1', 'h1') + HELPER_PAIR
    + '<div><label for="code" class="lbl">Kode pemasangan / Pairing code</label><input id="code" class="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" value="482019"></div>'
    + '<p role="alert" class="alert"><span lang="id">Tidak ada koneksi. Coba lagi saat sinyal stabil.</span><span class="en" lang="en">No connection. Try again when the signal is stable.</span></p>'
    + btn('Pasang', 'Pair', 'primary')
    + '<p class="note">Digit tetap tersimpan. / Digits are kept.</p>'
)))

# 4 success
steps = ''.join(
    '<li>' + bi(a, b, 'span') + '</li>' for a, b in [
        ('Letakkan HP di tempat tetap dan colokkan charger.', 'Put the phone in a fixed spot and plug it in.'),
        ('Layar harus tetap menyala dan halaman ini tetap terbuka. Menutup halaman berarti tidak mendengarkan.', 'Keep the screen on and this page open. Closing the page stops listening.'),
        ('Mulai bisa ditekan dari pukul 01:00 sampai pukul 22:00, setiap hari buka.', 'Mulai can be tapped from 01:00 until 22:00, on each open day.'),
        ('Selesai muncul 4 jam setelah Mulai.', 'Selesai appears 4 hours after Mulai.'),
    ])
BOARDS.append(('pair-success.dc.html', 'Pair: paired, first run', 360, 780, pair(
    bi('Perangkat terpasang', 'Phone paired', 'h1', 'h1')
    + bi('Terpasang untuk Demo Outlet', 'Paired to Demo Outlet', 'p', 'note')
    + '<ol class="steps">' + steps + '</ol>'
    + btn('Buka halaman mendengarkan', 'Open listening page', 'primary')
    + conf('C7', 'Layar menampilkan nama outlet. Halaman yang ada sekarang menampilkan id outlet mentah; perlu nama di respons pairing (perubahan API).')
)))

# 5 capture idle, Mulai enabled
BOARDS.append(('capture-idle.dc.html', 'Capture: idle, Mulai enabled', 360, 780, capture(
    'idle',
    note('Sudah jam buka. Tekan Mulai untuk mulai mendengarkan. Mulai bisa ditekan sampai pukul 22:00.', "It's opening time. Tap Mulai to start listening. Mulai is available until 22:00."),
    btn('Mulai', 'Start'), '', '',
    conf('C4', 'Hapus string lama "Rekaman besok mulai otomatis jam buka". Capture manual lewat Mulai.')
)))

# 6 listening
BOARDS.append(('capture-listening.dc.html', 'Capture: listening', 360, 780, capture(
    'listening',
    '',
    '<p class="note" style="margin:0"><span lang="id">Selesai bisa ditekan mulai pukul 17:00.</span><span class="en" lang="en">Selesai available from 17:00.</span></p>',
    '<div style="margin-top:0">' + btn('Batalkan sesi', 'Cancel session', 'secondary') + '</div>',
    uline('check', 'Unggah berhasil', 'Upload succeeded', 'ok')
)))

# 7 closing time passed, Selesai available
BOARDS.append(('capture-closing.dc.html', 'Capture: closing, Selesai', 360, 780, capture(
    'listening',
    note('Sudah jam tutup. Tekan Selesai bila operasional sudah selesai. Rekaman berhenti otomatis pukul 22:00.', "It's closing time. Tap Selesai when operations are done. Recording stops automatically at 22:00."),
    btn('Selesai', 'End (day)'),
    btn('Batalkan sesi', 'Cancel session', 'secondary'),
    uline('check', 'Unggah berhasil', 'Upload succeeded', 'ok'),
    '<div class="grp"><p class="tag">Varian · auto_stop_soon / Variant · auto-stop soon</p>' + note('Rekaman berhenti otomatis pukul 22:00 (10 menit lagi).', 'Recording stops automatically at 22:00 (10 min left).') + '</div>'
)))

# 8 interrupted
BOARDS.append(('capture-interrupted.dc.html', 'Capture: interrupted', 360, 780, capture(
    'interrupted',
    '',
    btn('Lanjutkan', 'Resume'),
    btn('Batalkan sesi', 'Cancel session', 'secondary'),
    uline('spin', 'Mengunggah', 'Uploading', 'muted')
)))

# 9 problem states
def card_hl(key, extra=''):
    return '<div class="card">' + hl(key) + extra + '</div>'
BOARDS.append(('capture-problems.dc.html', 'Capture: queue, mic, stalled', 360, 780, pair(
    '<p class="tag">Antrean penuh / Queue full</p>' + card_hl('queue_full', note('Rekaman lama terhapus; rekaman tidak pernah disimpan sebagai audio.', 'Older recordings are dropped; audio is never kept.'))
    + '<p class="tag">Masalah mikrofon / Microphone problem</p>' + card_hl('mic_error')
    + '<p class="tag">Tertahan / Stalled</p>' + card_hl('stalled')
    + conf('C2', 'Tidak ada alur di sini; catatan untuk pengecekan status. Diumumkan sekali saat berubah, bukan setiap poll.')
)))

# 10 blocked states
BOARDS.append(('capture-blocked.dc.html', 'Capture: loading, error, unsupported', 360, 780, pair(
    '<p class="tag">Memuat / Loading</p><div class="card">' + hl('loading') + '<div class="muted-block" aria-hidden="true"></div></div>'
    + '<p class="tag">Konfigurasi gagal / Config error</p><div class="card">' + hl('error')
    + bi('Jam buka belum termuat. Hubungkan internet sekali, lalu buka lagi.', 'Opening hours not loaded. Connect to the internet once, then reopen.', 'p', 'note')
    + btn('Coba lagi', 'Try again', 'secondary') + '</div>'
    + '<p class="tag">Browser tidak mendukung / Unsupported</p>' + card_hl('unsupported')
    + '<p class="tag">Tab lain / Another tab</p>' + card_hl('tab_busy')
)))

# 11 why-not notes
def why(reason, idt, en):
    return '<div class="card"><p class="tag">' + reason + '</p>' + bi(idt, en, 'p', 'note') + btn('Mulai', 'Start', 'secondary', 'aria-disabled="true"') + '</div>'
BOARDS.append(('mulai-why-not.dc.html', 'Mulai: disabled reasons', 360, 800, pair(
    why('day_ended', 'Hari operasional Rab 14 Okt sudah selesai. Mulai bisa ditekan lagi Kam 15 Okt pukul 01:00.', 'Business day Wed 14 Oct has ended. Mulai is available again Thu 15 Oct at 01:00.')
    + why('debrief_running', 'Debrief berlangsung sampai pukul 18:00. Mulai bisa ditekan lagi Kam 15 Okt pukul 01:00.', 'Debrief runs until 18:00. Mulai is available again Thu 15 Oct at 01:00.')
    + why('window_passed', 'Batas Mulai hari ini sudah lewat (pukul 22:00); hari ini dicatat libur. Mulai berikutnya Kam 15 Okt pukul 01:00.', "Today's Mulai cut-off has passed (22:00); today is recorded as off. Next Mulai Thu 15 Oct at 01:00.")
    + why('closed_day', 'Hari ini tutup. Mulai berikutnya Jum 16 Okt pukul 01:00.', 'Closed today. Next Mulai Fri 16 Oct at 01:00.')
    + '<div class="card"><p class="tag">Memulai · in flight / Starting</p>' + btn('Memulai…', 'Starting…', 'secondary', 'aria-disabled="true"') + '<p class="alert"><span lang="id">Mulai belum berhasil. Coba lagi.</span><span class="en" lang="en">Start didn\'t work. Try again.</span></p></div>'
)))

# 12 selesai confirm
BOARDS.append(('selesai-confirm.dc.html', 'Selesai: confirm', 360, 780, capture(
    'listening', '',
    btn('Selesai', 'End (day)', 'primary', 'aria-expanded="true"'),
    '<div class="grp" role="group" aria-labelledby="sel-h"><p id="sel-h" class="h2"><span lang="id">Akhiri operasional hari ini?</span><span class="en" lang="en">End today\'s operations?</span></p>'
    + bi('Debrief 1 jam dimulai sekarang. Tidak bisa dikembalikan. Mulai baru bisa ditekan lagi Kam 15 Okt pukul 01:00.', "The 1-hour debrief starts now. This can't be undone. Mulai will be available again Thu 15 Oct at 01:00.", 'p', 'note')
    + '<div class="btn-row">' + btn('Kembali', 'Back', 'secondary') + btn('Ya, selesai', 'Yes, end', 'primary') + '</div></div>',
    uline('check', 'Unggah berhasil', 'Upload succeeded', 'ok')
)))

# 13 batalkan confirm step 2
BOARDS.append(('batalkan-confirm.dc.html', 'Cancel session: confirm', 360, 780, capture(
    'listening', '', '<p class="note"><span lang="id">Rekaman tetap berjalan sampai Anda memilih.</span><span class="en" lang="en">Recording keeps running until you choose.</span></p>',
    '<div class="grp" role="group" aria-labelledby="can-h"><p id="can-h" class="h2"><span lang="id">Batalkan sesi?</span><span class="en" lang="en">Cancel session?</span></p>'
    + bi('Sesi ini dihapus dan hari ini tidak dihitung. Tidak bisa dikembalikan. Mulai baru bisa ditekan lagi Kam 15 Okt pukul 01:00.', "This session is deleted and today does not count. This can't be undone. Mulai is available again Thu 15 Oct at 01:00.", 'p', 'note')
    + '<div class="btn-row">' + btn('Ya, hapus sesi', 'Yes, delete session', 'danger', 'disabled') + btn('Kembali', 'Back', 'primary') + '</div>'
    + '<p class="tag"><span lang="id">Ya, hapus sesi aktif setelah 1 detik. Panel tutup sendiri setelah 15 detik.</span></p></div>',
    uline('check', 'Unggah berhasil', 'Upload succeeded', 'ok')
)))

# 14 upload line
upl = ''.join([
    '<div class="card"><p class="tag">Baris 1 · Row 1 (gagal, coba ulang)</p>' + uline('alert', 'Gagal unggah, coba ulang (1x)', 'Upload failed, retrying (1x)', 'warn')
    + '<p class="sub"><span lang="id">Server sibuk</span><span class="en" lang="en">Server busy</span></p></div>',
    '<div class="card"><p class="tag">Baris 1b · Row 1b (auth, 3 kali atau lebih)</p>' + uline('alert', 'Gagal unggah, coba ulang (3x)', 'Upload failed, retrying (3x)', 'warn')
    + '<p class="sub"><span lang="id">Hubungi supervisor</span><span class="en" lang="en">Contact the supervisor</span></p></div>',
    '<div class="card"><p class="tag">Baris 2 · Row 2</p>' + uline('spin', 'Mengunggah', 'Uploading', 'muted') + '</div>',
    '<div class="card"><p class="tag">Baris 3 · Row 3</p>' + uline('check', 'Unggah berhasil', 'Upload succeeded', 'ok') + '</div>',
    '<div class="card"><p class="tag">Baris 4 · Row 4 (lost line)</p>' + uline('alert', 'Gagal unggah, dilewati', 'Upload failed, skipped', 'warn') + guess('Teks baris 4 menunggu persetujuan Q14.') + '</div>',
    '<div class="toast" role="status"><span lang="id">Unggah berhasil lagi</span><span class="en" lang="en">Upload working again · shows once for 3 s</span></div>',
    conf('C10', 'Toast hanya saat pulih dari baris 1. PROD-01 §4.5 mendefinisikan keberhasilan hanya sebagai status baris. Konfirmasi.'),
    '<p class="note">Baris 5 · Row 5 (belum ada unggahan): baris disembunyikan. / Hidden.</p>',
])
BOARDS.append(('upload-line.dc.html', 'Upload status line', 360, 800, pair(upl)))

# 15 debrief entry
BOARDS.append(('debrief-entry.dc.html', 'Debrief: entry card', 360, 780, capture(
    'ended', '',
    '<div class="grp" style="gap:12px"><p class="h2"><span lang="id">Debrief berjalan</span><span class="en" lang="en">Debrief running</span></p>'
    + bi('Sisa 42 menit. 5 pertanyaan.', '42 minutes left. 5 questions.', 'p', 'note')
    + btn('Jawab pertanyaan', 'Answer questions')
    + bi('Butuh sekitar 5 menit.', 'Takes about 5 minutes.', 'p', 'note') + '</div>',
    '', uline('check', 'Unggah berhasil', 'Upload succeeded', 'ok'),
    note('Mulai berikutnya bisa ditekan pukul 01:00.', 'Next Mulai at 01:00.')
    + conf('C1', 'R-07 menaruh pintu debrief di jam tutup; PROD-01 D1 menaruhnya di Selesai atau auto-stop, berlangsung 1 jam. Layar ini mengikuti D1.')
)))

# 16 debrief question
BOARDS.append(('debrief-question.dc.html', 'Debrief: question', 360, 800, pair(
    '<p class="progress" style="margin:0;font-weight:700"><span lang="id">Pertanyaan 2 dari 4</span><span class="en" lang="en">Question 2 of 4</span></p>'
    + '<h2 class="h2" tabindex="-1"><span lang="id">Sekitar pukul 15:00 ada restock. Benar?</span><span class="en" lang="en">Around 15:00 there was a restock. Right?</span></h2>'
    + '<div role="radiogroup" aria-label="Benar atau tidak / Right or not" class="choice"><button type="button" role="radio" aria-checked="true">✓ Ya / Yes</button><button type="button" role="radio" aria-checked="false">Tidak / No</button></div>'
    + '<div><label for="reason" class="lbl"><span lang="id">Sudah sesuai SOP? Kalau belum, kenapa? (wajib, tanpa nama)</span><span class="en" lang="en">Was it done per the SOP? If not, why? (required, no names)</span></label>'
    + '<textarea id="reason" class="reason" rows="4" maxlength="500" autocomplete="off"></textarea>'
    + '<p class="counter">0/500</p><p class="counter warn">450/500 · 50 lagi / 50 left</p></div>'
    + '<div class="btn-row">' + btn('Lewati', 'Skip', 'secondary') + btn('Lanjut', 'Next', 'primary', 'aria-disabled="true"') + '</div>'
    + bi('Pilih Ya atau Tidak, lalu isi alasan.', 'Pick Yes or No, then write the reason.', 'p', 'note')
    + bi('Jawaban yang sudah Lanjut tidak bisa diubah.', 'Answers sent with Lanjut can\'t be changed.', 'p', 'note')
    + conf('C5', 'Pertanyaan memakai pola MVP 1 "Sekitar HH:MM ada <langkah>. Benar?". Kalimat R-07 "Apakah SOP ... dijalankan dengan benar?" tidak dipakai.')
    + conf('C8', 'Alasan wajib untuk Ya dan Tidak. Rangga perlu menyetujui; alasan Tidak adalah bukti celah untuk R-08.')
)))

# 17 debrief done
BOARDS.append(('debrief-done.dc.html', 'Debrief: done', 360, 780, pair(
    bi('Debrief selesai — terima kasih', 'Debrief done — thank you', 'h1', 'h1')
    + bi('Jawabanmu sudah tersimpan.', 'Your answers are saved.', 'p', 'note')
    + bi('Masih ada 2 jawaban yang belum terkirim, akan dikirim saat online.', '2 answers not sent yet, will be sent when online.', 'p', 'note')
    + bi('1 pertanyaan dilewati. Bisa dijawab sampai pukul 18:00.', '1 question skipped. You can answer it until 18:00.', 'p', 'note')
    + bi('Mulai bisa ditekan lagi pukul 01:00.', 'Mulai is available again at 01:00.', 'p', 'note')
    + btn('Kembali', 'Back', 'secondary')
    + conf('C6', 'Judul lama "Selesai — terima kasih!" bentrok dengan tombol Selesai. Judul baru di atas hanya usulan; perlu ditetapkan.')
)))

# 18 timeout
BOARDS.append(('debrief-timeout.dc.html', 'Debrief: timeout', 360, 780, capture(
    'ended', '',
    '<div class="card">' + bi('Waktu debrief habis pukul 18:00. Jawaban yang sudah Lanjut tetap tersimpan.', 'Debrief time ran out at 18:00. Answers sent with Lanjut are kept.', 'p', 'note')
    + bi('Teks yang belum Lanjut tidak tersimpan.', 'Text not sent with Lanjut is not saved.', 'p', 'note') + '</div>',
    '', uline('check', 'Unggah berhasil', 'Upload succeeded', 'ok'),
    note('Mulai bisa ditekan lagi pukul 01:00.', 'Mulai is available again at 01:00.')
)))

# 19 state strip
rows = [
 ('/pair', 'Kosong · Empty', 'Entry, no digits', 'Kosong, tanpa digit / Entry, no digits'),
 ('/pair', 'Memuat · Loading', 'Memasangkan… / Pairing…', 'Tombol berubah, kolom hanya baca'),
 ('/pair', 'Error', 'Kode ditolak / code refused; Tidak ada koneksi / no connection', 'Digit tetap tersimpan'),
 ('/capture', 'Kosong · Empty', 'Belum mulai + catatan Mulai', 'Belum mulai / Not started'),
 ('/capture', 'Memuat · Loading', 'Memuat… / Loading…', 'Tanpa tombol Mulai'),
 ('/capture', 'Error', 'Jam buka belum termuat + Coba lagi', 'Mulai tidak ditawarkan'),
 ('/capture', 'Offline', 'Berjalan dengan cache; baris unggah: coba ulang', 'Headline tetap jujur'),
 ('Mulai / Selesai', 'Memuat · Loading', 'Memulai… / Starting…', 'Tombol tidak bisa ditekan dua kali'),
 ('Mulai / Selesai', 'Error', 'Mulai belum berhasil. Coba lagi.', 'role alert'),
 ('Batalkan sesi', 'Memuat · Loading', 'Menghapus dari server… / Removing from server…', 'Panel tetap terbuka'),
 ('Batalkan sesi', 'Error · Offline', 'Akan dihapus saat online / Will be removed when back online', 'Sama dengan offline'),
 ('Debrief entry', 'Offline', 'Berjalan (cache)', 'Kartu tetap tampil'),
 ('Debrief pertanyaan', 'Kosong · Empty', 'Tidak ada pertanyaan hari ini — terima kasih.', 'Tombol Kembali'),
 ('Debrief pertanyaan', 'Memuat · Loading', 'Memuat pertanyaan… / Loading questions…', 'aria-busy, tanpa teks pertanyaan'),
 ('Debrief pertanyaan', 'Error', 'Pertanyaan belum bisa dimuat. Cek koneksi, lalu coba lagi.', 'Coba lagi, bukan daftar kosong'),
 ('Debrief pertanyaan', 'Offline', 'Tersimpan di HP, akan dikirim saat online.', 'Jawaban tetap tersimpan'),
 ('Debrief selesai', 'Error', 'Belum terkirim. Akan dicoba lagi otomatis.', 'Jawaban tetap di HP'),
]
tbl = ''.join('<tr><td>' + a + '</td><td>' + b + '</td><td>' + c + '<span class="en" style="font-size:12px">' + d + '</span></td></tr>' for a, b, c, d in rows)
BOARDS.append(('state-strip.dc.html', 'Empty, error, loading strip', 360, 800, pair(
    '<p class="h2"><span lang="id">Keadaan kosong, error, memuat</span><span class="en" lang="en">Empty, error and loading states</span></p>'
    + '<div class="tablewrap"><table><thead><tr><th>Layar / Screen</th><th>Keadaan / State</th><th>Teks / Copy</th></tr></thead><tbody>' + tbl + '</tbody></table></div>'
)))

# 20 open conflicts
cl = [
 ('C1', 'Waktu pintu debrief. R-07 menaruhnya di jam tutup; PROD-01 D1 di Selesai atau auto-stop (1 jam). Desain mengikuti D1.'),
 ('C2', 'Sisa sign-in di R-07 (nama + PIN, signOut, idle timeout). Desain membuangnya. Konfirmasi idle timeout dibuang atau dipindah ke pasca-MVP 1. Tanpa layar di sini.'),
 ('C3', 'Penyimpanan jawaban: R-07 menyimpan answered_by "staff" plus id perangkat; PROD-01 §4.11 tanpa answered_by. Tidak ada dampak UI, tetapi bentuk data harus ditetapkan sebelum rute dibuat.'),
 ('C4', 'Teks mulai otomatis besok di R-07 salah; capture manual lewat Mulai. Hapus string lama.'),
 ('C5', 'Wording pertanyaan: pola MVP 1 "Sekitar HH:MM ada <langkah>. Benar?" dipakai; R-07 late note berbeda. Pastikan hanya satu di kode.'),
 ('C6', 'Kata "Selesai": tombol operasional dan judul lama layar selesai debrief. Usulan ganti judul. Ratifikasi.'),
 ('C7', 'Id outlet mentah di /pair. Desain menampilkan nama; butuh nama di respons pairing (perubahan API).'),
 ('C8', 'Alasan wajib untuk Tidak juga. Rangga ratifikasi.'),
 ('C9', 'Bahasa Inggris saja di capture dan pair saat ini. Desain: Bahasa lalu baris EN. Konfirmasi keduanya tampil.'),
 ('C10', 'Toast unggah hanya saat pulih. PROD-01 §4.5 hanya status baris. Konfirmasi.'),
]
gl = ['Nama outlet di baris sukses pairing (C7).', 'Panduan 4 langkah dengan jam tutup per outlet.', 'Toast hanya saat pulih dari retrying (C10).', 'Judul selesai debrief (C6).', 'Wording baris privasi (PRIV-01, Q11).', 'Dua baris (ID + EN) di HP toko (C9).', 'Kartu debrief menampilkan jumlah pertanyaan ke staf.', 'Draf debrief per viewer di localStorage: tidak wajib untuk MVP 1.']
cl_html = ''.join('<li><b>' + a + '</b> ' + b + '</li>' for a, b in cl)
gl_html = ''.join('<li>' + g + '</li>' for g in gl)
BOARDS.append(('open-conflicts.dc.html', 'Open conflicts and guesses', 400, 820, pair(
    '<p class="h2"><span lang="id">Konflik terbuka (bagian 8)</span><span class="en" lang="en">Open conflicts (section 8)</span></p>'
    + '<ol class="steps" style="font-size:14px;line-height:20px">' + cl_html + '</ol>'
    + '<p class="h2"><span lang="id">Tebakan untuk dikonfirmasi (bagian 9)</span><span class="en" lang="en">Guesses to confirm (section 9)</span></p>'
    + '<ol class="steps" style="font-size:14px;line-height:20px">' + gl_html + '</ol>'
)))

def page(title, inner, w):
    return ('<!doctype html><html lang="id"><head><meta charset="utf-8"><title>' + title + '</title><script src="./support.js"></script></head>'
            '<body><x-dc><helmet><style>' + CSS + '</style></helmet>' + inner + '</x-dc>'
            '<script type="text/x-dc" data-dc-script data-props=\'{"$preview":{"width":' + str(w) + ',"height":740}}\'>'
            'class Component extends DCLogic { renderVals() { return {}; } }</script></body></html>')

boards = {}
order = []
files = []
for i, (key, title, w, h, inner) in enumerate(BOARDS):
    row, col = divmod(i, 4)
    x, y = col * 440, row * 900
    boards[key] = {"x": x, "y": y, "w": w, "h": h, "title": title}
    order.append(key)
    with open(os.path.join(P, key), 'w', encoding='utf-8') as f:
        f.write(page('bee6 UX-03 · ' + title, inner, w))
    files.append(key)

now = datetime.datetime.now().astimezone().isoformat(timespec='seconds')
canvas = {"v": 3, "createdOnFiles": {"v": 1, "at": now}, "title": "bee6 UX-03 Shop Phone Journey",
          "launch": {"view": "canvas"}, "pages": [], "boards": boards, "order": order, "notes": {}, "designSystems": []}
with open(os.path.join(P, '..', 'canvas.json'), 'w', encoding='utf-8') as f:
    json.dump(canvas, f, ensure_ascii=False, indent=1)
print(json.dumps({"files": {"project/" + k: "project/" + k for k in files}}, ensure_ascii=False))
