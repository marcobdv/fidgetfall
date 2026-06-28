#!/usr/bin/env node
// Tier-1 SFX synthesizer — generates real .wav files from code, no external tools.
// Studio capability used by the sound-designer role (see SKILL.md).
//
// Usage:
//   node synth-sfx.mjs <out.wav> [--type jump|hit|pickup|blip|explosion]
//                                [--wave square|sine|saw|noise]
//                                [--f0 300] [--f1 900] [--dur 0.18] [--vol 0.5]
//
// Examples:
//   node synth-sfx.mjs jump.wav   --type jump
//   node synth-sfx.mjs coin.wav   --type pickup
//   node synth-sfx.mjs hurt.wav   --type hit
//   node synth-sfx.mjs laser.wav  --wave saw --f0 1200 --f1 200 --dur 0.25

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const out = args[0];
if (!out) { console.error('error: output path required'); process.exit(1); }
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
// Numeric flag: error loudly on a missing/non-numeric value instead of silently
// producing NaN (which would write a zero-length, "successful" but empty WAV).
const num = (k, d) => {
  const i = args.indexOf('--' + k);
  if (i < 0) return d;
  const x = Number(args[i + 1]);
  if (!Number.isFinite(x)) { console.error(`error: --${k} expects a number, got "${args[i + 1]}"`); process.exit(1); }
  return x;
};

// Presets: small, recognizable game sounds. Override any field with flags.
const PRESETS = {
  jump:      { wave: 'square', f0: 300,  f1: 900,  dur: 0.18, vol: 0.5, decay: 1.6 },
  pickup:    { wave: 'square', f0: 660,  f1: 1320, dur: 0.12, vol: 0.45, decay: 1.2 },
  blip:      { wave: 'square', f0: 880,  f1: 880,  dur: 0.06, vol: 0.4, decay: 2.0 },
  hit:       { wave: 'noise',  f0: 400,  f1: 120,  dur: 0.16, vol: 0.55, decay: 2.2 },
  explosion: { wave: 'noise',  f0: 200,  f1: 40,   dur: 0.45, vol: 0.6, decay: 1.1 },
};
const base = PRESETS[opt('type', 'jump')] ?? PRESETS.jump;
const cfg = {
  wave:  opt('wave', base.wave),
  f0:    num('f0', base.f0),
  f1:    num('f1', base.f1),
  dur:   num('dur', base.dur),
  vol:   num('vol', base.vol),
  decay: num('decay', base.decay),
};

const SR = 22050;
const n = Math.max(1, Math.floor(SR * cfg.dur));
const data = Buffer.alloc(n * 2);
let last = 0;
let ph = 0;   // normalized phase in [0,1), accumulated so the glide ends exactly at f1
for (let i = 0; i < n; i++) {
  const p = i / n;
  const f = cfg.f0 + (cfg.f1 - cfg.f0) * p;     // instantaneous frequency (linear glide)
  ph = (ph + f / SR) % 1;                         // integrate frequency -> phase (not f*t)
  const env = Math.pow(1 - p, cfg.decay);        // amplitude decay envelope
  let s;
  switch (cfg.wave) {
    case 'sine':  s = Math.sin(2 * Math.PI * ph); break;
    case 'saw':   s = 2 * ph - 1; break;
    case 'noise': s = Math.random() * 2 - 1; break;
    default:      s = ph < 0.5 ? 1 : -1;         // square (chiptune)
  }
  if (cfg.wave === 'noise') s = (last = 0.6 * last + 0.4 * s); // simple low-pass
  const v = Math.max(-1, Math.min(1, s * env * cfg.vol));
  data.writeInt16LE((v * 32767) | 0, i * 2);
}

// 44-byte canonical WAV header (PCM, mono, 16-bit).
const h = Buffer.alloc(44);
h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
h.write('data', 36); h.writeUInt32LE(data.length, 40);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([h, data]));
console.log(`wrote ${out} — ${44 + data.length} bytes, ${cfg.dur}s, ${cfg.wave}, ${cfg.f0}->${cfg.f1}Hz`);
