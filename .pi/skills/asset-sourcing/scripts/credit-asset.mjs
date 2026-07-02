#!/usr/bin/env node
// Tier-1.5 asset sourcing — record provenance & attribution for a sourced asset,
// and refuse licenses that are unsafe for a (potentially commercial) studio game.
// Enforces the studio rule: no sourced asset without a CREDITS.md entry.
//
// Usage:
//   node credit-asset.mjs <gameDir> --asset <res-path> --source <site> --url <url> \
//        --license <CC0|CC-BY|CC-BY-SA|OFL|Pixabay|public-domain|...> \
//        --author <name> [--title <name>] [--allow-restrictive]
//
// Example:
//   node credit-asset.mjs games/sample-clockwork \
//     --asset assets/audio/sfx/door.wav --source Freesound \
//     --url https://freesound.org/s/123456/ --license CC0 --author "jane_doe"

import { writeFileSync, appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const a = process.argv.slice(2);
const gameDir = a[0];
const get = (k, d = '') => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
const has = (k) => a.includes('--' + k);
if (!gameDir || gameDir.startsWith('--') || has('help')) { console.error('usage: credit-asset.mjs <gameDir> --asset --source --url --license --author [--title]'); process.exit(1); }

const asset = get('asset'), source = get('source'), url = get('url');
const license = get('license'), author = get('author'), title = get('title', '');
for (const [k, v] of Object.entries({ asset, source, url, license, author }))
  if (!v) { console.error(`error: --${k} is required`); process.exit(1); }

// License safety classification. Default policy = safe for commercial use + modifiable.
// Match BOTH the abbreviation (as a whole token, so "INDIE" isn't read as "ND") and the
// spelled-out form (so "Attribution-NoDerivatives" is caught despite having no "ND" substring).
const raw = license.toUpperCase();
const compact = raw.replace(/[^A-Z0-9]/g, '');            // e.g. "CCBYNC"
const tokens = raw.split(/[^A-Z0-9]+/).filter(Boolean);   // e.g. ["CC","BY","NC"]
const tok = (t) => tokens.includes(t);
const NONCOMMERCIAL = tok('NC') || compact.includes('NONCOMMERCIAL');
const NODERIV = tok('ND') || compact.includes('NODERIV'); // NoDeriv / NoDerivs / NoDerivatives
const SHAREALIKE = tok('SA') || compact.includes('SHAREALIKE');
const PUBLIC = tok('CC0') || compact.includes('CC0') || compact.includes('PUBLICDOMAIN');
if ((NONCOMMERCIAL || NODERIV) && !has('allow-restrictive')) {
  console.error(`REFUSED: license "${license}" is ${NONCOMMERCIAL ? 'NonCommercial ' : ''}${NODERIV ? 'NoDerivatives ' : ''}— unsafe for a commercial/modifiable game.`);
  console.error('Pick a CC0/CC-BY/OFL asset instead, or pass --allow-restrictive if you have explicit permission.');
  process.exit(2);
}
const needsAttribution = !(PUBLIC || tok('PIXABAY') || tok('UNSPLASH'));
const note = [
  SHAREALIKE ? 'ShareAlike: derivatives must keep this license' : '',
  (NONCOMMERCIAL || NODERIV) ? 'RESTRICTIVE — confirmed permission' : '',
].filter(Boolean).join('; ');

const file = join(gameDir, 'CREDITS.md');
mkdirSync(gameDir, { recursive: true });
if (!existsSync(file)) {
  writeFileSync(file,
    '# Credits & asset attributions\n\n' +
    'Every sourced (Tier-1.5) and AI-generated (Tier-2) asset is logged here. CC0/public-domain\n' +
    'need no attribution but are still recorded for provenance; CC-BY etc. MUST stay attributed.\n\n' +
    '| Asset | Source | Author | License | Attribution required | URL | Note |\n' +
    '|---|---|---|---|---|---|---|\n');
}
const esc = (s) => s.replace(/\|/g, '\\|');   // "|" in a value would break the table
const row = `| \`${esc(asset)}\` | ${esc(source)} | ${esc(author)}${title ? ` — "${esc(title)}"` : ''} | ${esc(license)} | ${needsAttribution ? 'YES' : 'no'} | ${esc(url)} | ${esc(note)} |\n`;

// Idempotent: re-crediting the same asset path replaces its row instead of duplicating it.
const marker = `| \`${esc(asset)}\` |`;
const existing = readFileSync(file, 'utf8');
if (existing.split('\n').some((l) => l.startsWith(marker))) {
  writeFileSync(file, existing.split('\n').map((l) => l.startsWith(marker) ? row.trimEnd() : l).join('\n'));
  console.log(`updated ${asset} (${license}) -> ${file}${needsAttribution ? '  [attribution REQUIRED]' : ''}`);
} else {
  appendFileSync(file, row);
  console.log(`recorded ${asset} (${license}) -> ${file}${needsAttribution ? '  [attribution REQUIRED]' : ''}`);
}
