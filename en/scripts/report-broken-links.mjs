#!/usr/bin/env node
// Diffs the broken-reference lists produced by crawl-site.mjs for the PR head and the
// base branch, and writes a PR-comment / step-summary report split into:
//   - introduced by this PR   (in head, not in base)
//   - already on main          (in both)
//   - fixed by this PR         (in base, not in head)
// Always exits 0 — advisory, non-blocking.
//
// Usage: node scripts/report-broken-links.mjs --head <file> [--base <file>] [--out <comment.md>]

import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';

const MARKER = '<!-- broken-link-check -->';

const argv = process.argv.slice(2);
function flag(name) {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}
const headPath = flag('--head');
const basePath = flag('--base');
const outPath = flag('--out');

// Parse a crawl list file (STATUS\tTARGET\tCOUNT\tEXAMPLE) into a Map keyed by
// STATUS+TARGET (count/example are display-only and excluded from the diff key).
function parseList(path) {
  if (!path || !existsSync(path)) return null;
  const map = new Map();
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [status, target, count, example] = line.split('\t');
    map.set(`${status}\t${target}`, { status, target, count: Number(count) || 1, example: example || '' });
  }
  return map;
}

const head = parseList(headPath) || new Map();
const base = parseList(basePath);

function display(entry) {
  const where = entry.count > 1 ? `${entry.count} pages` : '1 page';
  const eg = entry.example ? `, e.g. \`${entry.example}\`` : '';
  return `- \`${entry.target}\` (${entry.status}) — ${where}${eg}`;
}

function pick(keys) {
  return keys.map((k) => head.get(k) || base.get(k)).sort((a, b) => a.target.localeCompare(b.target));
}

const headKeys = new Set(head.keys());
const baseKeys = base ? new Set(base.keys()) : null;

const introduced = baseKeys ? [...headKeys].filter((k) => !baseKeys.has(k)) : null;
const preExisting = baseKeys ? [...headKeys].filter((k) => baseKeys.has(k)) : [...headKeys];
const fixed = baseKeys ? [...baseKeys].filter((k) => !headKeys.has(k)) : [];

const total = head.size;

// Render a capped bullet list inside a collapsible <details> dropdown. `cap` of
// Infinity shows everything (used for the job summary); a finite cap trims the
// PR comment and adds a "+N more" pointer to the full list in the job summary.
function detailsList(summaryText, entries, cap) {
  const out = ['<details>', `<summary>${summaryText}</summary>`, ''];
  const shown = entries.slice(0, cap);
  out.push(...shown.map(display));
  if (entries.length > shown.length) {
    out.push(`- _…and ${entries.length - shown.length} more — see the full list in the workflow run's job summary._`);
  }
  out.push('', '</details>');
  return out;
}

// Build the whole report. cap limits the per-section list length (Infinity = no cap).
function buildReport(cap) {
  const lines = [];
  lines.push(MARKER);
  lines.push('## Broken links & images');
  lines.push('');
  lines.push('_Covers links, images, and assets from one crawl of the production build (baseUrl-aware)._');
  lines.push('');

  // Summary — counts first, so reviewers see the impact at a glance.
  lines.push('### Summary');
  lines.push('');
  lines.push(`- Total broken on this branch: **${total}**`);
  if (introduced === null) {
    lines.push('- Introduced by this PR: _n/a (no base-branch crawl to compare)_');
  } else {
    lines.push(`- 🆕 Introduced by this PR: **${introduced.length}**`);
    lines.push(`- 📄 Already on \`main\`: **${preExisting.length}**`);
    if (fixed.length > 0) lines.push(`- ✅ Fixed by this PR: **${fixed.length}**`);
  }
  lines.push('');

  // Introduced — the actionable section; keep it inside a dropdown too, expanded by default.
  lines.push('### Introduced by this PR');
  lines.push('');
  if (introduced === null) {
    lines.push('_No base-branch crawl available — see the full list below._');
    lines.push('');
  } else if (introduced.length === 0) {
    lines.push('No new broken links or images introduced by this PR. ✅');
    lines.push('');
  } else {
    lines.push(`This PR introduces **${introduced.length}** broken reference(s):`);
    lines.push('');
    const open = ['<details open>', `<summary>Show ${introduced.length}</summary>`, ''];
    const shown = pick(introduced).slice(0, cap);
    open.push(...shown.map(display));
    if (introduced.length > shown.length) {
      open.push(`- _…and ${introduced.length - shown.length} more — see the job summary for the full list._`);
    }
    open.push('', '</details>', '');
    lines.push(...open);
  }

  // Already on main — collapsed dropdown.
  const preLabel = baseKeys ? 'Already on `main`' : 'All broken references on this branch';
  lines.push(`### ${preLabel} — ${preExisting.length} total`);
  lines.push('');
  if (preExisting.length === 0) {
    lines.push('None.');
  } else {
    if (baseKeys) lines.push('Already broken on the base branch (not caused by this PR):');
    lines.push('');
    lines.push(...detailsList(`Show ${preExisting.length}`, pick(preExisting), cap));
  }
  lines.push('');

  if (fixed.length > 0) {
    lines.push(`### Fixed by this PR — ${fixed.length} total`);
    lines.push('');
    lines.push(...detailsList(`Show ${fixed.length}`, pick(fixed), cap));
    lines.push('');
  }

  return lines.join('\n') + '\n';
}

// Cap the per-section lists in the posted PR comment so it stays small; the job
// summary keeps the complete, uncapped list.
const COMMENT_CAP = 50;
const commentBody = buildReport(COMMENT_CAP);
const fullBody = buildReport(Infinity);

process.stdout.write(commentBody);

const summaryPath = process.env.GITHUB_STEP_SUMMARY;
if (summaryPath) {
  try {
    appendFileSync(summaryPath, fullBody);
  } catch {}
}
if (outPath) {
  try {
    writeFileSync(outPath, commentBody);
  } catch {}
}

process.exit(0);
