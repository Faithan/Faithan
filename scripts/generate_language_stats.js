#!/usr/bin/env node
/**
 * Custom language stats generator (includes private & org repos when token has access).
 * Usage (PowerShell):
 *   node scripts/generate_language_stats.js > assets/private-langs.svg
 * Requires environment variable: GITHUB_TOKEN (repo scope) or fine-grained equivalent with contents + metadata read.
 */

const https = require('https');

const USER = 'Faithan'; // Username for reference / fallback
const ORG_REPOS = [
  'Serviamus-Tech/KoaHive',
  'Serviamus-Tech/Serviamus'
];

// Allow comma‑separated extra repos via CLI:  node script.js repo1,ownerX/repo2
const extraArg = process.argv[2];
if (extraArg) {
  extraArg.split(',').map(s => s.trim()).filter(Boolean).forEach(r => ORG_REPOS.push(r));
}

const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error('Error: GITHUB_TOKEN not set.');
  process.exit(1);
}

function gh(path) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.github.com',
      path,
      headers: {
        'User-Agent': 'lang-stats-script',
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json'
      }
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        } else {
          reject(new Error(`GitHub API ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Use authenticated endpoint to include PRIVATE + ORG repos accessible by the token.
async function listAllAccessibleRepos() {
  let page = 1; const per_page = 100; const repos = [];
  // affiliation= owner,collaborator,organization_member covers personal + org membership
  while (true) {
    const batch = await gh(`/user/repos?per_page=${per_page}&page=${page}&affiliation=owner,collaborator,organization_member&sort=updated&direction=desc`);
    repos.push(...batch);
    if (batch.length < per_page) break;
    page++;
  }
  return repos;
}

async function getLanguages(fullName) {
  return gh(`/repos/${fullName}/languages`);
}

function aggregate(maps) {
  const total = {};
  for (const m of maps) {
    for (const [lang, bytes] of Object.entries(m)) {
      total[lang] = (total[lang] || 0) + bytes;
    }
  }
  return total;
}

function toSortedArray(langMap) {
  return Object.entries(langMap)
    .filter(([l,_b]) => _b > 0)
    .sort((a,b) => b[1]-a[1]);
}

function renderSVG(items) {
  const sum = items.reduce((acc, [_l, b]) => acc + b, 0) || 1;
  const width = 900;
  const leftPad = 24;
  const labelCol = 160;
  const barX = leftPad + labelCol + 10;
  const barWidth = width - barX - 90;
  const rowHeight = 24;
  const startY = 70;
  const barH = 12;
  const gap = 12;
  const height = startY + items.length * (barH + gap) + 40;

  const palette = ['#6366f1','#06b6d4','#10b981','#f59e0b','#ef4444','#8b5cf6','#14b8a6','#22c55e','#f97316','#e11d48','#0ea5e9','#84cc16','#64748b'];

  let y = startY;
  let bars = '';
  items.forEach(([lang, bytes], idx) => {
    const pct = (bytes / sum) * 100;
    const w = (pct/100) * barWidth;
    const color = palette[idx % palette.length];
    bars += `\n    <text x="${leftPad}" y="${y + barH - 1}" class="label">${lang}</text>`;
    bars += `\n    <rect x="${barX}" y="${y - 2}" width="${barWidth}" height="${barH}" fill="#1f2937" rx="6"/>`;
    bars += `\n    <rect x="${barX}" y="${y - 2}" width="${w}" height="${barH}" fill="${color}" rx="6"/>`;
    bars += `\n    <text x="${barX + barWidth + 10}" y="${y + barH - 1}" class="percent">${pct.toFixed(1)}%</text>`;
    y += barH + gap;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg">\n  <style>\n    .title { font: 600 18px/1.2 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial; fill:#e5e7eb;}\n    .label { font: 600 12px/1.2 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial; fill:#e5e7eb;}\n    .percent { font: 600 11px/1.2 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial; fill:#cbd5e1;}\n  </style>\n  <rect x="0" y="0" width="${width}" height="${height}" fill="#0d1117" rx="12"/>\n  <text x="24" y="40" class="title">Private + Public Language Mix</text>${bars}\n</svg>`;
}

(async () => {
  try {
    const accessibleRepos = await listAllAccessibleRepos();
    const allTargets = [
      ...accessibleRepos.filter(r => !r.fork).map(r => r.full_name),
      ...ORG_REPOS
    ];
    const unique = Array.from(new Set(allTargets));

    const langMaps = [];
    for (const fullName of unique) {
      try {
        const data = await getLanguages(fullName);
        langMaps.push(data);
      } catch (e) {
        console.error('Warn: failed languages for', fullName, e.message);
      }
    }

    const aggregated = aggregate(langMaps);
    const items = toSortedArray(aggregated).slice(0, 15);
    process.stdout.write(renderSVG(items));
  } catch (e) {
    console.error('Failed:', e);
    process.exit(1);
  }
})();
