/*!
 * /dev/dungeon — animated SVG replay.
 *
 * GitHub READMEs can't run code, so motion has to come from an image. Each
 * Action run records a snapshot after every simulated turn and this module
 * turns them into one looping SVG driven by discrete SMIL keyframes: the map
 * reveals itself, the daemon and monsters move, bars and the log update. It is
 * a replay of the turns the engine actually played, not a canned animation.
 *
 * Size matters (a new file is committed every frame), so everything static is
 * drawn once and each changing value gets its own small track.
 */
'use strict';

const { W, H } = require('./engine.js');

const STEP = 0.3; // seconds per turn
const HOLD = 0.7; // last turn stays up while the loop fades back to the start
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
const CW = 7; // monospace digit advance used by the turn odometer
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

const C = {
  bg: '#0b1220', panel: '#070c16', line: '#1e293b', text: '#cbd5e1', bright: '#e2e8f0', dim: '#64748b', faint: '#334155',
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
const HL = HUD_X + 14, HR = HUD_X + HUD_W - 14;
const row = (i) => MAP_Y + 12 + i * T;
const textAt = (x, y, body, fill, extra = '') => `<text x="${x}" y="${y}" fill="${fill}"${extra}>${body}</text>`;

// A text value that only re-renders when it changes.
function field(snaps, tl, valueOf, x, y, { fill = C.text, anchor = 'start', extra = '' } = {}) {
  const values = snaps.map((s) => valueOf(s));
  const colorOf = typeof fill === 'function' ? fill : () => fill;
  const a = anchor === 'end' ? ' text-anchor="end"' : '';
  return tl.runs(values.map((v, i) => `${v}|${colorOf(snaps[i])}`), (i) =>
    values[i] === '' ? '' : textAt(x, y, values[i], colorOf(snaps[i]), a + extra));
}

// A bar whose fill width and colour are tracked per turn.
function meter(snaps, tl, x, y, w, ratioOf, colorOf, withTrack = true) {
  const widths = snaps.map((s) => (w * Math.max(0, Math.min(1, ratioOf(s)))).toFixed(1));
  const colors = snaps.map((s) => colorOf(s));
  return (withTrack ? `<rect x="${x}" y="${y}" width="${w}" height="7" rx="3.5" fill="${C.line}"/>` : '') +
    `<rect x="${x}" y="${y}" width="${widths[0]}" height="7" rx="3.5" fill="${colors[0]}">${tl.track('width', widths)}${tl.track('fill', colors)}</rect>`;
}

function hudLayer(snaps, tl) {
  const hpColor = (s) => {
    const r = s.hero.hp / s.hero.maxHp;
    return r > 0.5 ? '#4ade80' : r > 0.25 ? '#facc15' : '#f87171';
  };
  const gear = (i, ch, label) => textAt(HL, row(i), `<tspan fill="${ITEM_COLOR[ch]}">${esc(ch)}</tspan>${label ? ` ${label}` : ''}`, C.text);
  const right = { anchor: 'end', fill: C.dim };
  let out =
    // static labels and bar tracks
    textAt(HL, row(3), 'HP', C.dim) + textAt(HL, row(4), 'XP', C.dim) +
    textAt(HL, row(6), 'atk', C.dim) + textAt(HR - 22, row(6), 'def', C.dim, ' text-anchor="end"') +
    gear(7, ')') + gear(8, '[') + gear(9, '!', 'hotfix') + gear(10, '*', 'stars') +
    textAt(HL, row(12), 'depth', C.dim) + textAt(HR - 30, row(12), 'kills', C.dim, ' text-anchor="end"') +
    textAt(HL, row(14), 'in view', C.dim) +
    // live values
    field(snaps, tl, (s) => `DAEMON #${pad(s.run, 3)}`, HL, row(0), { fill: C.hero, extra: ' font-weight="700"' }) +
    field(snaps, tl, (s) => `lvl ${pad(s.hero.lvl, 2)}`, HR, row(0), { anchor: 'end' }) +
    field(snaps, tl, (s) => `pid ${s.hero.pid}`, HL, row(1), { fill: C.dim }) +
    field(snaps, tl, (s) => s.hero.mode, HR, row(1), { anchor: 'end', fill: (s) => MODE_COLOR[s.hero.mode] || C.dim }) +
    meter(snaps, tl, HL + 24, row(3) - 7, 118, (s) => s.hero.hp / s.hero.maxHp, hpColor) +
    field(snaps, tl, (s) => `${s.hero.hp}/${s.hero.maxHp}`, HR, row(3), { anchor: 'end' }) +
    meter(snaps, tl, HL + 24, row(4) - 7, 118, (s) => s.hero.xp / s.hero.need, () => '#a78bfa') +
    field(snaps, tl, (s) => `${Math.floor((100 * s.hero.xp) / s.hero.need)}%`, HR, row(4), { anchor: 'end' }) +
    field(snaps, tl, (s) => pad(s.hero.atk, 2), HL + 28, row(6), { fill: C.bright }) +
    field(snaps, tl, (s) => pad(s.hero.def, 2), HR, row(6), { anchor: 'end', fill: C.bright }) +
    field(snaps, tl, (s) => esc(s.hero.tool[0]), HL + 14, row(7)) +
    field(snaps, tl, (s) => `+${s.hero.tool[1]}`, HR, row(7), right) +
    field(snaps, tl, (s) => esc(s.hero.guard[0]), HL + 14, row(8)) +
    field(snaps, tl, (s) => `+${s.hero.guard[1]}`, HR, row(8), right) +
    field(snaps, tl, (s) => `x${s.hero.potions}`, HR, row(9), right) +
    field(snaps, tl, (s) => String(s.hero.stars), HR, row(10), right) +
    field(snaps, tl, (s) => `<tspan fill="${C.bright}">${pad(s.depth, 2)}</tspan> ${esc(s.path)}`, HL + 42, row(12), { fill: C.stairs }) +
    field(snaps, tl, (s) => pad(s.hero.kills, 3), HR, row(12), { anchor: 'end', fill: C.bright }) +
    field(snaps, tl, (s) => (s.monsters.length ? String(s.monsters.length) : 'clear'), HR, row(14), {
      anchor: 'end', fill: (s) => (s.monsters.length ? '#f87171' : C.dim),
    });
  // the two nearest monsters in view, each with a health meter
  for (const slot of [0, 1]) {
    const m = (s) => s.monsters[slot];
    out += field(snaps, tl, (s) => (m(s) ? `<tspan fill="${MONSTER_COLOR[m(s).k]}" font-weight="700">${esc(m(s).k)}</tspan> ${esc(m(s).name)}` : ''),
      HL, row(15 + slot), { fill: C.text });
    out += tl.shown(snaps.map((s) => !!m(s)),
      meter(snaps, tl, HR - 40, row(15 + slot) - 7, 40, (s) => (m(s) ? m(s).hp / m(s).maxHp : 0), (s) => (m(s) ? MONSTER_COLOR[m(s).k] : C.line)));
  }
  return out;
}

// Rolling digits: one strip of 0-9 per position, shifted per turn.
function odometer(snaps, tl, xRight, y) {
  const values = snaps.map((s) => s.turn);
  const digits = Math.max(6, String(Math.max(...values)).length);
  let out = `<clipPath id="odo"><rect x="${xRight - digits * CW - 1}" y="${y - 11}" width="${digits * CW + 2}" height="${T}"/></clipPath>` +
    `<g clip-path="url(#odo)" fill="${C.bright}" text-anchor="middle">`;
  for (let d = 0; d < digits; d++) {
    const at = values.map((v) => +pad(v, digits)[d]);
    const x = xRight - (digits - d) * CW + CW / 2;
    const strip = Array.from({ length: 10 }, (_, k) => `<tspan x="${x}" y="${y + k * T}">${k}</tspan>`).join('');
    out += `<g transform="translate(0 ${-at[0] * T})">${tl.move(at.map((v) => `0 ${-v * T}`))}<text>${strip}</text></g>`;
  }
  return { svg: `${out}</g>`, width: digits * CW };
}

// ------------------------------------------------------------- frame
function renderReplay(snaps, meta) {
  const tl = timeline(snaps.length);
  const first = snaps[0].turn, last = snaps[snaps.length - 1].turn;
  const { lantern, hero } = heroLayers(snaps, tl);
  const playEnd = (((snaps.length - 1) * STEP) / tl.dur).toFixed(4);
  const fadeIn = (0.35 / tl.dur).toFixed(4), fadeOut = ((tl.dur - 0.5) / tl.dur).toFixed(4);
  const fullBar = WIDTH - 2 * PAD;
  const turn = odometer(snaps, tl, WIDTH - PAD, 29);

  const where = tl.runs(snaps.map((s) => `${s.run}|${s.depth}`), (i) => {
    const s = snaps[i];
    return `<text x="${PAD + 212}" y="29" fill="${C.dim}">daemon <tspan fill="${C.hero}">#${pad(s.run, 3)}</tspan> · depth ` +
      `<tspan fill="${C.bright}">${pad(s.depth, 2)}</tspan> <tspan fill="${C.stairs}">${esc(s.path)}</tspan></text>`;
  });
  // mapped % in 5% steps keeps the status line from re-rendering every step
  const status = tl.runs(snaps.map((s) => `${s.path}|${Math.floor(s.mapped / 5) * 5}|${s.records.bestDepth}|${s.records.bestRun}|${s.records.deaths}`), (i) => {
    const s = snaps[i], r = s.records;
    return `<text x="${MAP_X}" y="${STATUS_Y + 17}" fill="${C.dim}">${esc(s.path)} ${Math.floor(s.mapped / 5) * 5}% mapped · record depth ${pad(r.bestDepth, 2)} by #${pad(r.bestRun, 3)} · ${r.deaths} daemon${r.deaths === 1 ? '' : 's'} lost</text>`;
  });
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
<text x="${PAD + 84}" y="29" fill="${C.bright}" font-weight="700" font-size="13.5">/dev/dungeon</text>
${where}
<text x="${WIDTH - PAD - turn.width - 6}" y="29" fill="${C.dim}" text-anchor="end">frame #${meta.frame} · turn</text>
${turn.svg}
<rect x="${PAD}" y="${HEAD - 4}" width="${fullBar}" height="2" rx="1" fill="${C.line}"/>
<rect x="${PAD}" y="${HEAD - 4}" width="0" height="2" rx="1" fill="#ef4444"><animate attributeName="width" values="0;${fullBar};${fullBar}" keyTimes="0;${playEnd};1" dur="${tl.dur}s" repeatCount="indefinite"/></rect>
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
${hudLayer(snaps, tl)}
<rect x="${MAP_X - 8}" y="${STATUS_Y}" width="${WIDTH - MAP_X - PAD + 8}" height="26" rx="8" fill="${C.panel}" stroke="${C.line}"/>
${status}
${log}
<rect x="1" y="${HEAD}" width="${WIDTH - 2}" height="${HEIGHT - HEAD - 1}" fill="${C.bg}" opacity="0"><animate attributeName="opacity" values="0.85;0;0;0.85" keyTimes="0;${fadeIn};${fadeOut};1" dur="${tl.dur}s" repeatCount="indefinite"/></rect>
</g>
</svg>
`;
}

module.exports = { renderReplay };
