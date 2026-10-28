#!/usr/bin/env node
/**
 * -----------------------------------------------------------------------------
 *  Dynamic GitHub Profile README Generator
 * -----------------------------------------------------------------------------
 *  Fetches live data from the GitHub API and injects it into README.md between
 *  marker comments, e.g.:
 *
 *      <!-- GH:LANGUAGES:START -->  ...generated...  <!-- GH:LANGUAGES:END -->
 *
 *  Data rendered:
 *    • STATS       – repos / stars / forks / followers / contributions badges
 *    • LANGUAGES   – top languages with accurate percentages + an animated stacked-bar SVG
 *    • TOP_REPOS   – most-starred repos as badge rows (live stars / forks counts)
 *    • RECENT      – recently pushed projects as badge rows (relative time)
 *    • assets/lang-dist.svg – the language bar, rewritten on every run
 *
 *  Uses only Node.js built-ins (global fetch). No npm dependencies required.
 *  Auth: uses GITHUB_TOKEN when available (GraphQL language aggregation +
 *  contribution stats), otherwise falls back to unauthenticated REST.
 * -----------------------------------------------------------------------------
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ----------------------------- configuration --------------------------------
const USERNAME = process.env.GH_USERNAME || 'abhrajyoti-01';
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const README_PATH = path.join(__dirname, '..', '..', 'README.md');
const MAX_REPOS = 100; // safety cap for language aggregation
const TOP_LANGUAGES = 8;
const TOP_REPOS = 6;
const RECENT_REPOS = 5;
const API = 'https://api.github.com';

// Languages excluded from the "top languages" breakdown (noise / non-code).
const IGNORED_LANGUAGES = new Set(['HTML', 'CSS', 'SCSS', 'Less', 'Shell', 'Dockerfile', 'Makefile', 'CMake', 'Markdown']);

// Language -> brand colour for the bar (used as a subtle accent in the label).
const LANG_EMOJI = {
  Python: '🐍', JavaScript: '🟨', TypeScript: '🔷', Go: '🐹', C: '🔵',
  'C++': '🔴', 'C#': '🟪', Java: '☕', Rust: '🦀', Ruby: '💎', PHP: '🐘',
  Swift: '🍎', Kotlin: '🟣', Dart: '🎯', Shell: '🐚', HTML: '🌐', CSS: '🎨',
};

// Language -> presentation style for the chips and the distribution bar:
// gradient stops (bar) + shields logo slug (chip). Unknown languages stay on-theme.
const LANG_STYLE = {
  C: { from: '#6ea8dc', to: '#3d6fb4', logo: 'c' },
  'C++': { from: '#f27ba0', to: '#c34d74', logo: 'cplusplus' },
  'C#': { from: '#3dcf6e', to: '#1f9c47', logo: 'csharp' },
  Go: { from: '#3fd2f0', to: '#0790b4', logo: 'go' },
  Rust: { from: '#edb894', to: '#b5754f', logo: 'rust' },
  Python: { from: '#4a90d9', to: '#2a5f96', logo: 'python' },
  Java: { from: '#e08a3c', to: '#b0651d', logo: 'java' },
  Kotlin: { from: '#a78bfa', to: '#7c53e8', logo: 'kotlin' },
  Swift: { from: '#ff8a5c', to: '#e05f2b', logo: 'swift' },
  Ruby: { from: '#ef6060', to: '#c23a3a', logo: 'ruby' },
  PHP: { from: '#8a95d6', to: '#5c68ad', logo: 'php' },
  Dart: { from: '#41c1f0', to: '#1e8fc4', logo: 'dart' },
  TypeScript: { from: '#4d9fe6', to: '#2b6cb8', logo: 'typescript' },
  JavaScript: { from: '#ffe14d', to: '#c9a227', logo: 'javascript' },
  default: { from: '#a371f7', to: '#8957e5', logo: null },
};

// Language -> skillicons.dev ids. The first entry is the language icon itself;
// the rest are its common ecosystem/framework icons. Used to auto-generate the
// "Tech Arsenal" section from the languages actually present in the profile.
const SKILL_MAP = {
  C: ['c'],
  'C++': ['cpp'],
  'C#': ['cs'],
  Go: ['go'],
  Rust: ['rust'],
  Python: ['python', 'fastapi', 'django'],
  Java: ['java', 'spring'],
  Kotlin: ['kotlin'],
  Swift: ['swift'],
  Ruby: ['ruby', 'rails'],
  PHP: ['php', 'laravel'],
  Dart: ['dart', 'flutter'],
  JavaScript: ['js', 'nodejs', 'express'],
  TypeScript: ['ts', 'react', 'nextjs'],
  PLpgSQL: ['postgres'],
  SQL: ['mysql'],
  'Jupyter Notebook': ['python'],
};

// Always-present tooling row (universal for this profile).
const TOOLING_ICONS = ['git', 'github', 'githubactions', 'docker', 'linux', 'vscode', 'postgres', 'redis'];

// ------------------------------- http helper --------------------------------
async function ghFetch(url, { graphql = false, body = null } = {}) {
  const headers = {
    Accept: graphql ? 'application/json' : 'application/vnd.github+json',
    'User-Agent': 'abhrajyoti-readme-bot',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;

  const init = { headers };
  if (graphql) {
    init.method = 'POST';
    init.body = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText} for ${url} :: ${text.slice(0, 200)}`);
  }
  return res.json();
}

// GraphQL is only attempted when a token is present.
async function tryGraphQL(query, variables) {
  if (!TOKEN) return null;
  try {
    const json = await ghFetch(`${API}/graphql`, { graphql: true, body: { query, variables } });
    if (json && json.data) return json.data;
    return null;
  } catch (err) {
    console.warn('⚠️  GraphQL unavailable, using REST fallback:', err.message);
    return null;
  }
}

// ----------------------------- utility helpers ------------------------------
function relativeTime(isoDate) {
  if (!isoDate) return 'recently';
  const then = new Date(isoDate).getTime();
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  const hours = Math.round(mins / 60);
  const days = Math.round(hours / 24);
  const months = Math.round(days / 30);
  const years = Math.round(days / 365);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

function n(value) {
  return Number(value || 0).toLocaleString('en-US');
}

function truncate(str, len) {
  if (!str) return '';
  // Descriptions land inside HTML tables, so escape markup rather than pipes.
  const clean = str.replace(/\s+/g, ' ').trim();
  const cut = clean.length > len ? clean.slice(0, len - 1).trimEnd() + '…' : clean;
  return cut.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function badge(label, message, color, logo) {
  const l = encodeURIComponent(label);
  const m = encodeURIComponent(message);
  const lg = logo ? `&logo=${logo}&logoColor=white` : '';
  return `<img src="https://img.shields.io/badge/${l}-${m}-${color}?style=for-the-badge${lg}" alt="${label}"/>`;
}

function emojiFor(lang) {
  return LANG_EMOJI[lang] || '📦';
}

// Brand-coloured shields chip for a language (logo + name on its gradient end-colour).
function langChip(lang) {
  const st = LANG_STYLE[lang] || LANG_STYLE.default;
  const bg = st.to.slice(1);
  const logo = st.logo ? `&logo=${st.logo}` : '';
  return `<img src="https://img.shields.io/badge/${encodeURIComponent(lang)}-${bg}?style=for-the-badge&logoColor=white${logo}" alt="${lang}"/>`;
}

// Dark repo-name pill that links to the repository (⭐ / 🕒 prefix).
function repoBadge(r, icon) {
  const label = encodeURIComponent(`${icon} ${r.name}`.replace(/_/g, '__'));
  return `<a href="${r.html_url}"><img src="https://img.shields.io/badge/${label}-%E2%86%92-00E5FF?style=for-the-badge&labelColor=0d1117&logo=github&logoColor=00E5FF" alt="${r.name}"/></a>`;
}

// ------------------------------ data collection -----------------------------
async function fetchAllRepos() {
  const repos = [];
  for (let page = 1; page <= 5; page++) {
    const batch = await ghFetch(
      `${API}/users/${USERNAME}/repos?per_page=100&sort=pushed&page=${page}`
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos;
}

function languageListFromTotals(totals) {
  const grand = Object.values(totals).reduce((a, b) => a + b, 0);
  return Object.entries(totals)
    .map(([lang, bytes]) => ({ lang, bytes, pct: grand ? (bytes / grand) * 100 : 0 }))
    .sort((a, b) => b.bytes - a.bytes);
}

// One authenticated GraphQL request replaces one REST request per repository.
// This keeps scheduled profile updates below GitHub's rate limit and preserves
// byte-accurate language percentages.
async function aggregateLanguagesGraphQL() {
  const query = `query($login:String!){
    user(login:$login){
      repositories(first:100, ownerAffiliations:OWNER, isFork:false, isArchived:false){
        nodes{
          languages(first:100, orderBy:{field:SIZE, direction:DESC}){
            edges{ size node{ name } }
          }
        }
      }
    }
  }`;
  const data = await tryGraphQL(query, { login: USERNAME });
  const nodes = data?.user?.repositories?.nodes;
  if (!Array.isArray(nodes)) return null;

  const totals = Object.create(null);
  for (const repo of nodes) {
    for (const edge of repo.languages?.edges || []) {
      const lang = edge.node?.name;
      if (!lang || IGNORED_LANGUAGES.has(lang)) continue;
      totals[lang] = (totals[lang] || 0) + Number(edge.size || 0);
    }
  }
  return languageListFromTotals(totals);
}

async function aggregateLanguages(repos) {
  if (TOKEN) {
    const graphLanguages = await aggregateLanguagesGraphQL();
    if (graphLanguages && graphLanguages.length > 0) return graphLanguages;
    console.warn('⚠️  GraphQL language aggregation unavailable, using REST fallback.');
  }

  const owned = repos.filter((r) => !r.fork && !r.archived).slice(0, MAX_REPOS);
  const totals = Object.create(null);
  let failures = 0;

  await Promise.all(
    owned.map(async (repo) => {
      try {
        const langs = await ghFetch(`${API}/repos/${USERNAME}/${repo.name}/languages`);
        for (const [lang, bytes] of Object.entries(langs)) {
          if (IGNORED_LANGUAGES.has(lang)) continue;
          totals[lang] = (totals[lang] || 0) + bytes;
        }
      } catch (err) {
        failures++;
        console.warn(`⚠️  Skipping languages for ${repo.name}:`, err.message);
      }
    })
  );

  if (failures > 0) {
    throw new Error(`Language data incomplete: ${failures}/${owned.length} repositories could not be read. README left unchanged.`);
  }

  return languageListFromTotals(totals);
}

async function fetchContributions() {
  const query = `query($login:String!){
    user(login:$login){
      contributionsCollection {
        totalCommitContributions
        totalPullRequestContributions
        totalIssueContributions
        totalPullRequestReviewContributions
        contributionCalendar { totalContributions }
      }
    }
  }`;
  const data = await tryGraphQL(query, { login: USERNAME });
  if (!data || !data.user) return null;
  const c = data.user.contributionsCollection;
  return {
    commits: c.totalCommitContributions,
    prs: c.totalPullRequestContributions,
    issues: c.totalIssueContributions,
    reviews: c.totalPullRequestReviewContributions,
    contributions1y: c.contributionCalendar.totalContributions,
  };
}

// ------------------------------ section renderers ---------------------------
function renderStats(user, repos, contrib) {
  const owned = repos.filter((r) => !r.fork);
  const stars = owned.reduce((s, r) => s + r.stargazers_count, 0);
  const forks = owned.reduce((s, r) => s + r.forks_count, 0);

  const metrics = [
    ['Repositories', owned.length],
    ['Stars', stars],
    ['Forks', forks],
    ['Followers', user.followers],
  ];

  if (contrib) {
    metrics.push(
      ['Contributions (1y)', contrib.contributions1y],
      ['Commits (1y)', contrib.commits],
      ['Pull requests', contrib.prs],
      ['Issues opened', contrib.issues]
    );
  }

  const metricCell = ([label, value]) => `<td align="center" width="25%"><strong>${n(value)}</strong><br /><sub>${label}</sub></td>`;
  const rows = [
    `<tr>${metrics.slice(0, 4).map(metricCell).join('')}</tr>`,
  ];
  if (metrics.length > 4) {
    rows.push(`<tr>${metrics.slice(4).map(metricCell).join('')}</tr>`);
  }

  return `<table align="center">${rows.join('')}</table>`;
}

// Top languages for display: drop negligible slivers (< 0.5%) so the chart stays
// meaningful, but always keep at least the top 4 even on a small profile.
function topLanguages(langs) {
  const significant = langs.filter((l) => l.pct >= 0.5);
  return (significant.length >= 4 ? significant : langs).slice(0, TOP_LANGUAGES);
}

function renderLanguages(langs) {
  const top = topLanguages(langs);
  if (top.length === 0) return '_Language data unavailable._';

  const header = `| Rank | Language | Share |\n| :-: | :-- | :-: |`;
  const body = top
    .map((l, i) => `| **${String(i + 1).padStart(2, '0')}** | \`${l.lang}\` | **${l.pct.toFixed(1)}%** |`)
    .join('\n');

  const rest = langs.length - top.length;
  const more = rest > 0 ? `\n\n<sub>Plus ${rest} additional language${rest === 1 ? '' : 's'}.</sub>` : '';
  const alt = top.map((l) => `${l.lang} ${l.pct.toFixed(1)}%`).join(', ');

  return `> Byte-weighted across public, non-fork, non-archived repositories.\n\n${header}\n${body}\n\n<img src="assets/lang-dist.svg" width="100%" alt="Byte-weighted language distribution — ${alt}"/>${more}`;
}

// Animated stacked-bar SVG (written to assets/lang-dist.svg each run). Segments
// grow in with SMIL on every load; percentage labels fade in above them.
function renderLangBar(top) {
  const W = 900, H = 64, Y = 20, HGT = 26;
  if (top.length === 0) return '';
  const style = (l) => LANG_STYLE[l.lang] || LANG_STYLE.default;

  const topPct = top.reduce((sum, l) => sum + l.pct, 0);
  const remainder = Math.max(0, 100 - topPct);
  const entries = remainder > 0.05 ? [...top, { lang: 'Other', pct: remainder }] : top;
  const segs = entries.map((l) => ({ l, w: (l.pct / 100) * W }));
  let acc = 0;
  for (const s of segs) { s.x = acc; acc += s.w; }
  segs[segs.length - 1].w = W - segs[segs.length - 1].x; // close rounding drift exactly at W

  const defs = segs
    .map((s, i) => {
      const st = style(s.l);
      return `<linearGradient id="lg${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${st.from}"/><stop offset="1" stop-color="${st.to}"/></linearGradient>`;
    })
    .join('\n    ');

  const rects = segs
    .map(
      (s, i) =>
        `<rect x="${s.x.toFixed(1)}" y="${Y}" width="${s.w.toFixed(1)}" height="${HGT}" fill="url(#lg${i})"><animate attributeName="width" from="0" to="${s.w.toFixed(1)}" dur="0.9s" begin="${(i * 0.1).toFixed(1)}s" fill="freeze" calcMode="spline" keySplines="0.2 0.6 0.3 1"/></rect>`
    )
    .join('\n    ');

  const labels = segs
    .map((s, i) => {
      if (s.w < 54) return '';
      const cx = (s.x + s.w / 2).toFixed(1);
      return `<text x="${cx}" y="${Y + HGT / 2 + 4}" text-anchor="middle" font-family="monospace" font-size="12" font-weight="bold" fill="#ffffff" opacity="0">${Math.round(s.l.pct)}%<animate attributeName="opacity" from="0" to="1" dur="0.5s" begin="${(0.7 + i * 0.08).toFixed(2)}s" fill="freeze"/></text>`;
    })
    .filter(Boolean)
    .join('\n    ');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Byte-weighted language share bar">
  <defs>
    ${defs}
    <clipPath id="lclip"><rect x="0" y="${Y}" width="${W}" height="${HGT}" rx="7"/></clipPath>
    <filter id="lshadow" x="-5%" y="-40%" width="110%" height="200%"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000000" flood-opacity="0.45"/></filter>
  </defs>
  <g clip-path="url(#lclip)" filter="url(#lshadow)">
    <rect x="0" y="${Y}" width="${W}" height="${HGT}" fill="#161f29"/>
    ${rects}
  </g>
  ${labels}
</svg>`;
}

function renderTopRepos(repos) {
  const top = repos
    .filter((r) => !r.fork)
    .sort(
      (a, b) =>
        b.stargazers_count - a.stargazers_count ||
        b.forks_count - a.forks_count ||
        new Date(b.pushed_at) - new Date(a.pushed_at)
    )
    .slice(0, TOP_REPOS);

  if (top.length === 0) return '_No repositories yet._';

  const rows = top.map((r, i) => {
    const desc = truncate(r.description, 84) || '_No description._';
    const language = r.language ? `<code>${r.language}</code>` : '';
    const stats = `<sub>★ ${n(r.stargazers_count)} · forks ${n(r.forks_count)} ${language}</sub>`;
    return `<tr><td width="6%"><strong>${String(i + 1).padStart(2, '0')}</strong></td><td><a href="${r.html_url}"><strong>${r.name}</strong></a><br /><sub>${desc}</sub></td><td align="right">${stats}</td></tr>`;
  });

  return `<table>${rows.join('')}</table>`;
}

function renderRecent(repos) {
  const recent = repos
    .filter((r) => !r.fork && r.name !== USERNAME)
    .sort((a, b) => new Date(b.pushed_at) - new Date(a.pushed_at))
    .slice(0, RECENT_REPOS);

  if (recent.length === 0) return '_No recent activity._';

  const rows = recent.map((r, i) => {
    const when = relativeTime(r.pushed_at);
    const desc = truncate(r.description, 84);
    const language = r.language ? `<code>${r.language}</code>` : '';
    return `<tr><td width="6%"><strong>${String(i + 1).padStart(2, '0')}</strong></td><td><a href="${r.html_url}"><strong>${r.name}</strong></a>${desc ? `<br /><sub>${desc}</sub>` : ''}</td><td align="right"><sub>${language} · ${when}</sub></td></tr>`;
  });

  return `<table>${rows.join('')}</table>`;
}

function renderTech(langs) {
  // Derive the icon rows from the languages actually detected in the profile so
  // the Tech Arsenal always mirrors real activity.
  const detected = langs
    .filter((l) => SKILL_MAP[l.lang])
    .slice(0, TOP_LANGUAGES)
    .map((l) => l.lang);

  const langIcons = [...new Set(detected.map((lang) => SKILL_MAP[lang][0]))].filter((id) => !TOOLING_ICONS.includes(id));
  const ecoIcons = [];
  for (const lang of detected) {
    for (const id of SKILL_MAP[lang].slice(1)) {
      if (!ecoIcons.includes(id)) ecoIcons.push(id);
    }
  }

  const line = (icons) =>
    `<img src="https://skillicons.dev/icons?i=${icons.join(',')}&theme=dark" alt="${icons.join(', ')}" />`;

  const parts = [];
  if (langIcons.length) {
    parts.push(`**Languages & runtimes**\n\n${line(langIcons)}`);
  }
  if (ecoIcons.length) {
    parts.push(`**Frameworks & delivery**\n\n${line(ecoIcons)}`);
  }
  parts.push(`**Infrastructure**\n\n${line(TOOLING_ICONS)}`);

  return `<div align="center">\n\n${parts.join('\n\n')}\n\n</div>`;
}

// ----------------------------- README injection -----------------------------
function inject(content, section, generated) {
  const start = `<!-- GH:${section}:START -->`;
  const end = `<!-- GH:${section}:END -->`;
  const startIdx = content.indexOf(start);
  const endIdx = content.indexOf(end);

  if (startIdx === -1 || endIdx === -1) {
    console.warn(`⚠️  Markers for "${section}" not found — skipped.`);
    return { content, ok: false };
  }

  const before = content.slice(0, startIdx + start.length);
  const after = content.slice(endIdx);
  return { content: `${before}\n${generated}\n${after}`, ok: true };
}

async function main() {
  console.log(`🚀 Generating dynamic README for @${USERNAME}${TOKEN ? ' (authenticated)' : ' (unauthenticated)'}\n`);

  if (!fs.existsSync(README_PATH)) {
    console.error('❌ README.md not found at', README_PATH);
    process.exit(1);
  }

  let content = fs.readFileSync(README_PATH, 'utf8');
  const original = content;

  let user, repos;
  try {
    [user, repos] = await Promise.all([
      ghFetch(`${API}/users/${USERNAME}`),
      fetchAllRepos(),
    ]);
  } catch (err) {
    console.error('❌ Failed to fetch core GitHub data:', err.message);
    console.error('   README left unchanged.');
    process.exit(1);
  }

  console.log(`✅ Fetched profile + ${repos.length} repositories`);

  const [langs, contrib] = await Promise.all([
    aggregateLanguages(repos),
    fetchContributions(),
  ]);
  console.log(`✅ Aggregated ${langs.length} languages${contrib ? ' + contribution stats' : ' (no GraphQL stats)'}`);

  const sections = {
    STATS: renderStats(user, repos, contrib),
    LANGUAGES: renderLanguages(langs),
    TOP_REPOS: renderTopRepos(repos),
    RECENT: renderRecent(repos),
    TECH: renderTech(langs),
  };

  // Rewrite the animated language-distribution bar referenced by the LANGUAGES section.
  try {
    const assetsDir = path.join(__dirname, '..', '..', 'assets');
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.writeFileSync(path.join(assetsDir, 'lang-dist.svg'), renderLangBar(topLanguages(langs)));
  } catch (err) {
    console.warn('⚠️  Could not write language bar:', err.message);
  }

  let updatedCount = 0;
  for (const [section, generated] of Object.entries(sections)) {
    const res = inject(content, section, generated);
    if (res.ok) {
      content = res.content;
      updatedCount++;
    }
  }

  if (content === original) {
    console.log('\nℹ️  No changes to write.');
    return;
  }

  fs.writeFileSync(README_PATH, content, 'utf8');
  console.log(`\n🎉 README.md updated — ${updatedCount}/${Object.keys(sections).length} sections refreshed.`);
}

main().catch((err) => {
  console.error('❌ Unexpected error:', err);
  process.exit(1);
});
