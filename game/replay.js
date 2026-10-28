/*!
 * /dev/dungeon — animated SVG replay.
 *
 * GitHub READMEs can't run code, so motion has to come from an image. Each
 * Action run records a snapshot after every simulated turn and this module
 * turns them into one looping SVG driven by discrete SMIL keyframes: the map
 * reveals itself, the daemon and monsters move, bars and the log update. It is
 * a replay of the turns the engine actually played, not a canned animation.
 */
'use strict';

const { W, H } = require('./engine.js');

const STEP = 0.32; // seconds per turn
const HOLD = 2.4; // pause on the last turn before the loop restarts
const T = 14; // tile size
const PAD = 22;
const HEAD = 46;
const MAP_X = PAD + 8, MAP_Y = HEAD + 14;
const MAP_W = W * T, MAP_H = H * T;
const HUD_X = MAP_X + MAP_W + 30, HUD_W = 232;
const WIDTH = HUD_X + HUD_W + PAD;
const STATUS_Y = MAP_Y + MAP_H + 16;
const LOG_Y = STATUS_Y + 44;
const LOG_LH = 17;
const HEIGHT = LOG_Y + 6 * LOG_LH + PAD;
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

const C = {
  bg: '#0b1220', panel: '#070c16', line: '#1e293b', text: '#cbd5e1', dim: '#64748b', faint: '#334155',
  hero: '#67e8f9', hurt: '#f87171', wall: '#5b6b82', floor: '#2a3850', tunnel: '#15223a', door: '#f59e0b', stairs: '#a78bfa',
};
const MONSTER_COLOR = {
  b: '#f87171', x: '#fb923c', n: '#f472b6', l: '#facc15', r: '#e879f9', z: '#a3e635', H: '#2dd4bf', S: '#ef4444', D: '#f43f5e',
};
const ITEM_COLOR = { '!': '#4ade80', '*': '#fde047', ')': '#60a5fa', '[': '#c084fc', '?': '#e2e8f0' };
const LOG_COLOR = { '+': '#4ade80', '-': '#f87171', '!': '#fb923c', '#': '#64748b', '@@': '#a78bfa' };
const MODE_COLOR = {
  fighting: '#f87171', hunting: '#fb923c', resting: '#4ade80', patching: '#4ade80', exploring: '#67e8f9',
  looting: '#fde047', deploying: '#a78bfa', blocked: '#f43f5e',
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pad = (n, len) => String(n).padStart(len, '0');

// ------------------------------------------------------------- timeline
function timeline(n) {
  const dur = +((n - 1) * STEP + HOLD).toFixed(2);
  const key = (i) => (i === 0 ? '0' : ((i * STEP) / dur).toFixed(4));
  const smil = (head, perFrame) => {
    const values = [], keys = [];
    perFrame.forEach((v, i) => {
      if (i === 0 || v !== perFrame[i - 1]) { values.push(v); keys.push(key(i)); }
    });
    if (values.length === 1) return '';
    return `<${head} values="${values.join(';')}" keyTimes="${keys.join(';')}" calcMode="discrete" dur="${dur}s" repeatCount="indefinite"/>`;
  };
  return {
    n, dur,
    track: (attr, perFrame) => smil(`animate attributeName="${attr}"`, perFrame),
    move: (perFrame) => smil('animateTransform attributeName="transform" type="translate"', perFrame),
    // A group that is visible exactly on the frames where visible[i] is true.
    shown(visible, body) {
      if (!body || !visible.some(Boolean)) return '';
      const v = visible.map((b) => (b ? 1 : 0));
      return `<g opacity="${v[0]}">${this.track('opacity', v)}${body}</g>`;
    },
    // Render once per run of consecutive frames that share the same key.
    runs(keys, render) {
      let out = '';
      for (let start = 0, i = 1; i <= n; i++) {
        if (i < n && keys[i] === keys[start]) continue;
        out += this.shown(keys.map((_, f) => f >= start && f < i), render(start));
        start = i;
      }
      return out;
    },
  };
}

// --------------------------------------------------------------- map
function tilesSvg(tiles, cells) {
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? ' ' : tiles[y][x]);
  let walls = '', tunnels = '', floors = '', doors = '', stairs = '';
  for (const i of cells) {
    const x = i % W, y = (i / W) | 0, t = tiles[y][x];
    const cx = MAP_X + x * T + T / 2, cy = MAP_Y + y * T + T / 2;
    if (t === '#') {
      let joined = false;
      for (const [dx, dy] of DIRS) {
        const nt = at(x + dx, y + dy);
        if (nt === '#' || nt === '+') { walls += `M${cx} ${cy}l${(dx * T) / 2} ${(dy * T) / 2}`; joined = true; }
      }
      if (!joined) walls += `M${cx - 2} ${cy}h4`;
    } else if (t === ',' || t === '+') {
      tunnels += `M${cx} ${cy}h0`;
      for (const [dx, dy] of DIRS) {
        const nt = at(x + dx, y + dy);
        if (nt === ',' || (t === ',' && nt === '+')) tunnels += `M${cx} ${cy}l${(dx * T) / 2} ${(dy * T) / 2}`;
      }
      if (t === '+') doors += `M${cx - 2.5} ${cy - 2.5}h5v5h-5z`;
    } else if (t === '.') {
      floors += `M${cx - 1} ${cy - 1}h2v2h-2z`;
    } else if (t === '>') {
      stairs += `M${cx - 5} ${cy + 5}h3.5v-3.5h3.5v-3.5h3.5v-3.5`;
    }
  }
  return [
    tunnels && `<path d="${tunnels}" stroke="${C.tunnel}" stroke-width="7" stroke-linecap="round" fill="none"/>`,
    floors && `<path d="${floors}" fill="${C.floor}"/>`,
    walls && `<path d="${walls}" stroke="${C.wall}" stroke-width="2" stroke-linecap="square" fill="none"/>`,
    doors && `<path d="${doors}" fill="${C.door}"/>`,
    stairs && `<path d="${stairs}" stroke="${C.stairs}" stroke-width="2" fill="none" stroke-linejoin="round" filter="url(#glow)"/>`,
  ].join('');
}

// One layer per floor; inside it, tiles appear on the turn the daemon first saw them.
function mapLayer(snaps, tl) {
  let out = '';
  for (let s = 0; s < snaps.length; ) {
    let e = s + 1;
    while (e < snaps.length && snaps[e].floor === snaps[s].floor) e++;
    const seenAt = new Array(W * H).fill(-1);
    for (let f = s; f < e; f++) {
      snaps[f].seen.forEach((v, i) => { if (v && seenAt[i] === -1) seenAt[i] = f; });
    }
    const reveal = new Map();
    seenAt.forEach((f, i) => { if (f !== -1) reveal.set(f, [...(reveal.get(f) || []), i]); });
    for (const [f, cells] of [...reveal].sort((a, b) => a[0] - b[0])) {
      out += tl.shown(snaps.map((_, i) => i >= f && i < e), tilesSvg(snaps[s].tiles, cells));
    }
    s = e;
  }
  return out;
}

// ---------------------------------------------------------- entities
const glyph = (ch, color, extra = '') =>
  `<text x="${MAP_X + T / 2}" y="${MAP_Y + T / 2}" fill="${color}"${extra}>${esc(ch)}</text>`;

function itemsLayer(snaps, tl) {
  const items = new Map();
  snaps.forEach((s, i) => s.items.forEach((it) => {
    const key = `${s.floor}|${it.k}|${it.x}|${it.y}`;
    if (!items.has(key)) items.set(key, { ...it, on: snaps.map(() => false) });
    items.get(key).on[i] = true;
  }));
  let out = '';
  for (const it of items.values()) {
    out += tl.shown(it.on, `<g transform="translate(${it.x * T} ${it.y * T})">${glyph(it.k, ITEM_COLOR[it.k])}</g>`);
  }
  return out;
}

function monstersLayer(snaps, tl) {
  const tracks = new Map();
  snaps.forEach((s, i) => s.monsters.forEach((m) => {
    if (!tracks.has(m.id)) tracks.set(m.id, { k: m.k, pos: snaps.map(() => null), hp: snaps.map(() => null) });
    const tr = tracks.get(m.id);
    tr.pos[i] = `${m.x * T} ${m.y * T}`;
    tr.hp[i] = m.hp;
  }));
  let out = '';
  for (const tr of tracks.values()) {
    const on = tr.pos.map((p) => p !== null);
    const first = tr.pos.find((p) => p !== null);
    const pos = [];
    tr.pos.forEach((p, i) => pos.push(p ?? (i ? pos[i - 1] : first)));
    // flash white on the turn it takes a hit
    const fill = tr.hp.map((hp, i) => (i && hp !== null && tr.hp[i - 1] !== null && hp < tr.hp[i - 1] ? '#ffffff' : MONSTER_COLOR[tr.k]));
    const size = tr.k === 'D' ? ' font-size="17"' : '';
    out += tl.shown(on, `<g transform="translate(${pos[0]})">${tl.move(pos)}` +
      `<text x="${MAP_X + T / 2}" y="${MAP_Y + T / 2}" fill="${fill[0]}"${size}>${tl.track('fill', fill)}${esc(tr.k)}</text></g>`);
  }
  return out;
}

function heroLayers(snaps, tl) {
  const pos = snaps.map((s) => `${s.hero.x * T} ${s.hero.y * T}`);
  const fill = snaps.map((s, i) =>
    i && s.run === snaps[i - 1].run && s.hero.hp < snaps[i - 1].hero.hp ? C.hurt : C.hero);
  const lantern = `<g transform="translate(${pos[0]})">${tl.move(pos)}` +
    `<circle cx="${MAP_X + T / 2}" cy="${MAP_Y + T / 2}" r="52" fill="url(#lantern)"/></g>`;
  const hero = `<g transform="translate(${pos[0]})">${tl.move(pos)}` +
    `<text x="${MAP_X + T / 2}" y="${MAP_Y + T / 2}" fill="${fill[0]}" font-size="15" filter="url(#glow)">${tl.track('fill', fill)}@</text></g>`;
  return { lantern, hero };
}

// --------------------------------------------------------------- hud
function bar(x, y, w, ratio, color) {
  const f = Math.max(0, Math.min(1, ratio));
  return `<rect x="${x}" y="${y}" width="${w}" height="7" rx="3.5" fill="${C.line}"/>` +
    (f > 0 ? `<rect x="${x}" y="${y}" width="${(w * f).toFixed(1)}" height="7" rx="3.5" fill="${color}"/>` : '');
}

function hudSvg(s) {
  const h = s.hero, L = HUD_X + 14, R = HUD_X + HUD_W - 14;
  const row = (i) => MAP_Y + 12 + i * T;
  const left = (i, text, fill = C.text, extra = '') => `<text x="${L}" y="${row(i)}" fill="${fill}"${extra}>${text}</text>`;
  const right = (i, text, fill = C.text) => `<text x="${R}" y="${row(i)}" fill="${fill}" text-anchor="end">${text}</text>`;
  const hpRatio = h.hp / h.maxHp;
  const hpColor = hpRatio > 0.5 ? '#4ade80' : hpRatio > 0.25 ? '#facc15' : '#f87171';
  const gear = (i, ch, name, val) =>
    left(i, `<tspan fill="${ITEM_COLOR[ch]}">${esc(ch)}</tspan> ${esc(name)}`) + right(i, esc(val), C.dim);
  let out =
    left(0, `DAEMON #${pad(s.run, 3)}`, C.hero, ' font-weight="700"') + right(0, `lvl ${pad(h.lvl, 2)}`) +
    left(1, `pid ${h.pid}`, C.dim) + right(1, h.mode, MODE_COLOR[h.mode] || C.dim) +
    left(3, 'HP', C.dim) + bar(L + 24, row(3) - 7, 118, hpRatio, hpColor) + right(3, `${h.hp}/${h.maxHp}`) +
    left(4, 'XP', C.dim) + bar(L + 24, row(4) - 7, 118, h.xp / h.need, '#a78bfa') + right(4, `${Math.floor((100 * h.xp) / h.need)}%`) +
    left(6, `atk <tspan fill="#e2e8f0">${pad(h.atk, 2)}</tspan>`, C.dim) + right(6, `def <tspan fill="#e2e8f0">${pad(h.def, 2)}</tspan>`, C.dim) +
    gear(7, ')', h.tool[0], `+${h.tool[1]}`) +
    gear(8, '[', h.guard[0], `+${h.guard[1]}`) +
    gear(9, '!', 'hotfix', `x${h.potions}`) +
    gear(10, '*', 'stars', String(h.stars)) +
    left(12, `depth <tspan fill="#e2e8f0">${pad(s.depth, 2)}</tspan> <tspan fill="${C.stairs}">${esc(s.path)}</tspan>`, C.dim) +
    right(12, `kills <tspan fill="#e2e8f0">${pad(h.kills, 3)}</tspan>`, C.dim) +
    left(14, 'in view', C.dim) + right(14, s.monsters.length ? String(s.monsters.length) : 'clear', s.monsters.length ? '#f87171' : C.dim);
  s.monsters.slice(0, 2).forEach((m, i) => {
    out += left(15 + i, `<tspan fill="${MONSTER_COLOR[m.k]}" font-weight="700">${esc(m.k)}</tspan> ${esc(m.name)}`) +
      bar(R - 40, row(15 + i) - 7, 40, m.hp / m.maxHp, MONSTER_COLOR[m.k]);
  });
  return out;
}

// ------------------------------------------------------------- frame
function renderReplay(snaps, meta) {
  const tl = timeline(snaps.length);
  const first = snaps[0].turn, last = snaps[snaps.length - 1].turn;
  const { lantern, hero } = heroLayers(snaps, tl);
  const progressEnd = (((snaps.length - 1) * STEP) / tl.dur).toFixed(4);
  const fullBar = WIDTH - 2 * PAD;

  const header = tl.runs(snaps.map((s) => `${s.run}|${s.depth}|${s.turn}`), (i) => {
    const s = snaps[i];
    return `<text x="${PAD + 212}" y="29" fill="${C.dim}">daemon <tspan fill="${C.hero}">#${pad(s.run, 3)}</tspan> · depth ` +
      `<tspan fill="#e2e8f0">${pad(s.depth, 2)}</tspan> <tspan fill="${C.stairs}">${esc(s.path)}</tspan> · turn <tspan fill="#e2e8f0">${pad(s.turn, 6)}</tspan></text>`;
  });
  const hud = tl.runs(snaps.map((s) => JSON.stringify([s.run, s.depth, s.hero, s.monsters.map((m) => [m.k, m.hp])])), (i) => hudSvg(snaps[i]));
  const status = tl.runs(snaps.map((s) => s.status), (i) =>
    `<text x="${MAP_X}" y="${STATUS_Y + 17}" fill="${C.dim}">${esc(snaps[i].status)}</text>`);
  const log = tl.runs(snaps.map((s) => s.log.map((l) => l.text).join('\n')), (i) =>
    snaps[i].log.slice(-6).map((l, j) =>
      `<text x="${MAP_X}" y="${LOG_Y + j * LOG_LH}" fill="${LOG_COLOR[l.c] || C.text}">${esc(l.text)}</text>`).join(''));

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" role="img" aria-labelledby="title desc">
<title id="title">/dev/dungeon — replay of turns ${first}–${last}</title>
<desc id="desc">A zero-player roguelike replaying the ${snaps.length - 1} turns simulated in frame ${meta.frame}: daemon #${snaps[snaps.length - 1].run} at depth ${snaps[snaps.length - 1].depth}.</desc>
<defs>
<radialGradient id="lantern"><stop offset="0" stop-color="#67e8f9" stop-opacity="0.22"/><stop offset="1" stop-color="#67e8f9" stop-opacity="0"/></radialGradient>
<filter id="glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<pattern id="grid" width="${T}" height="${T}" patternUnits="userSpaceOnUse" x="${MAP_X}" y="${MAP_Y}"><path d="M${T} 0H0V${T}" fill="none" stroke="#ffffff" stroke-opacity="0.025"/></pattern>
</defs>
<g font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace" font-size="11.5">
<rect width="${WIDTH}" height="${HEIGHT}" rx="16" fill="${C.bg}"/>
<rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${HEIGHT - 1}" rx="15.5" fill="none" stroke="${C.line}"/>
<circle cx="${PAD + 5}" cy="25" r="4.5" fill="#ef4444"><animate attributeName="opacity" values="1;0.25;1" dur="1.4s" repeatCount="indefinite"/></circle>
<text x="${PAD + 16}" y="29" fill="#ef4444" font-weight="700" letter-spacing="2">REPLAY</text>
<text x="${PAD + 84}" y="29" fill="#e2e8f0" font-weight="700" font-size="13.5">/dev/dungeon</text>
${header}
<text x="${WIDTH - PAD}" y="29" fill="${C.dim}" text-anchor="end">frame #${meta.frame} · turns ${first}–${last}</text>
<rect x="${PAD}" y="${HEAD - 4}" width="${fullBar}" height="2" rx="1" fill="${C.line}"/>
<rect x="${PAD}" y="${HEAD - 4}" width="0" height="2" rx="1" fill="#ef4444"><animate attributeName="width" values="0;${fullBar};${fullBar}" keyTimes="0;${progressEnd};1" dur="${tl.dur}s" repeatCount="indefinite"/></rect>
<rect x="${MAP_X - 8}" y="${MAP_Y - 8}" width="${MAP_W + 16}" height="${MAP_H + 16}" rx="10" fill="${C.panel}" stroke="${C.line}"/>
<rect x="${MAP_X}" y="${MAP_Y}" width="${MAP_W}" height="${MAP_H}" fill="url(#grid)"/>
<rect x="${HUD_X}" y="${MAP_Y - 8}" width="${HUD_W}" height="${MAP_H + 16}" rx="10" fill="${C.panel}" stroke="${C.line}"/>
${lantern}
${mapLayer(snaps, tl)}
<g font-size="13" font-weight="700" text-anchor="middle" dominant-baseline="central">
${itemsLayer(snaps, tl)}
${monstersLayer(snaps, tl)}
${hero}
</g>
${hud}
<rect x="${MAP_X - 8}" y="${STATUS_Y}" width="${WIDTH - MAP_X - PAD + 8}" height="26" rx="8" fill="${C.panel}" stroke="${C.line}"/>
${status}
${log}
</g>
</svg>
`;
}

module.exports = { renderReplay };
