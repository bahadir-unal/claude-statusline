#!/usr/bin/env node
// Claude Code statusLine -> oh-my-posh koprusu.
// Claude Code stdin'den JSON verir; oh-my-posh'un boyle bir girdiden haberi yok.
// Bu script alanlari CC_* env degiskenlerine cevirip claude.omp.json'a besler.
import { readFileSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIG = join(HERE, 'claude.omp.json');

let d = {};
try {
  // PowerShell pipe'i basa BOM ekler; Claude Code eklemez ama elle testte JSON.parse patlar.
  d = JSON.parse(readFileSync(0, 'utf8').replace(/^﻿/, '')) || {};
} catch {
  // Bos/bozuk stdin: segmentler bos kalir, bar yine de cizilir.
}

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);

// --- context penceresi ------------------------------------------------------
const cw = d.context_window || {};
const pct = num(cw.used_percentage);
const size = num(cw.context_window_size);
const humanSize = size ? (size >= 1e6 ? `${size / 1e6}M` : `${Math.round(size / 1000)}K`) : '';
const ctx = pct === null ? '' : `${pct.toFixed(1)}%${humanSize ? '/' + humanSize : ''}`;

// --- maliyet ----------------------------------------------------------------
const cost = num(d.cost?.total_cost_usd);

// --- efor kisaltmasi --------------------------------------------------------
// Bar dar; gorseldeki gibi 3-4 harfe indiriyoruz (xhigh -> xhi).
const EFFORT = { low: 'low', medium: 'med', high: 'high', xhigh: 'xhi', max: 'max' };

// --- MCP sunucu sayisi ------------------------------------------------------
// Global + bu dizine tanimli sunucular. Okunamazsa 0 -> segment gizlenir.
function mcpCount(dir) {
  try {
    const cfg = JSON.parse(readFileSync(join(process.env.USERPROFILE || process.env.HOME || '', '.claude.json'), 'utf8'));
    const names = new Set(Object.keys(cfg.mcpServers || {}));
    // Ayni dizin .claude.json'da hem "C:/x" hem "C:\x" olarak kayitli olabilir;
    // ilk eslesmeyi alirsak bos olani yakalayabiliriz - hepsini birlestir.
    const norm = (s) => String(s).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    const target = norm(dir);
    for (const [k, v] of Object.entries(cfg.projects || {})) {
      if (norm(k) !== target) continue;
      for (const n of Object.keys(v.mcpServers || {})) names.add(n);
    }
    return names.size;
  } catch {
    return 0;
  }
}

// --- calisan subagent sayisi ------------------------------------------------
// Ana statusline JSON'unda boyle bir alan yok; transcript'in kuyrugundan cikariyoruz.
// Her hata durumunda 0 doner -> segment gizlenir (bar asla bozulmaz).
function runningAgents(path) {
  try {
    if (!path) return 0;
    const size = statSync(path).size;
    const want = Math.min(size, 512 * 1024);
    const buf = Buffer.alloc(want);
    const fd = openSync(path, 'r');
    try { readSync(fd, buf, 0, want, size - want); } finally { closeSync(fd); }

    const lines = buf.toString('utf8').split('\n');
    // Sadece dosyayi gercekten kirptiysak ilk satir yarim kalmis olabilir.
    if (want < size) lines.shift();
    const started = new Set();
    const finished = new Set();
    for (const line of lines) {
      // Arac adi eski surumlerde "Task", yenilerde "Agent".
      if (!line || (!line.includes('"Task"') && !line.includes('"Agent"') && !line.includes('tool_result'))) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      const content = o?.message?.content;
      if (!Array.isArray(content)) continue;
      for (const c of content) {
        if (c?.type === 'tool_use' && (c?.name === 'Task' || c?.name === 'Agent') && c?.id) started.add(c.id);
        else if (c?.type === 'tool_result' && c?.tool_use_id) finished.add(c.tool_use_id);
      }
    }
    let n = 0;
    for (const id of started) if (!finished.has(id)) n++;
    return n;
  } catch {
    return 0;
  }
}
const agents = runningAgents(d.transcript_path);

// --- oh-my-posh cagrisi -----------------------------------------------------
const cwd = d.workspace?.current_dir || d.cwd || process.cwd();
// Gecersiz bir dizini spawn cwd'si olarak vermek execFileSync'i patlatir ve
// tum bar fallback'e duser; once dogrula, olmazsa bu surecin dizininde calis.
let spawnCwd = process.cwd();
try { if (statSync(cwd).isDirectory()) spawnCwd = cwd; } catch { /* varsayilanda kal */ }
const width = parseInt(process.env.COLUMNS || '', 10) || 120;

const env = {
  ...process.env,
  // oh-my-posh, POSH_SESSION_ID ile anahtarlanan session cache'ini --config bayraginin
  // onune gecirir. Profildeki `oh-my-posh init` atomic.omp.json'u o cache'e yazar ve
  // Claude Code degiskeni baslatildigi shell'den miras aldigi icin bar atomic temasiyla
  // ciziliyordu. Kendi sabit id'miz mirasi keser; sabit oldugu icin de her render'da
  // yeni bir ~51KB cache dosyasi birikmez.
  POSH_SESSION_ID: 'claude-code-statusline',
  POSH_CONFIG: CONFIG,
  CC_MODEL: d.model?.display_name || '',
  CC_EFFORT: EFFORT[d.effort?.level] || d.effort?.level || '',
  CC_THINK: d.thinking?.enabled ? '1' : '',
  CC_CTX: ctx,
  CC_CTX_N: pct === null ? '0' : String(Math.round(pct)),
  CC_COST: cost === null ? '' : `$${cost.toFixed(2)} (sub)`,
  CC_AGENTS: agents > 0 ? `${agents} agent${agents > 1 ? 's' : ''}` : '',
  CC_MCP: String(mcpCount(cwd) || ''),
  CC_SESSION: d.session_name || '',
};

const args = [
  'print', 'primary',
  '--config', CONFIG,
  '--shell', 'pwsh',          // pwsh: readline escape'i eklemez, ANSI temiz cikar
  '--pwd', cwd,
  '--terminal-width', String(width),
];

let out = '';
for (const exe of ['oh-my-posh.exe', 'oh-my-posh']) {
  try {
    out = execFileSync(exe, args, { env, cwd: spawnCwd, encoding: 'utf8', windowsHide: true });
    break;
  } catch {
    // sonraki adayi dene
  }
}

if (out) process.stdout.write(out.replace(/\r?\n$/, ''));
else process.stdout.write(`${env.CC_MODEL} ${cwd}`); // oh-my-posh yoksa sade fallback
