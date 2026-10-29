/*!
 * /dev/dungeon — a zero-player roguelike that lives inside a GitHub README.
 *
 * The simulation is pure and deterministic: the whole world (map, RNG state,
 * hero, monsters, log) round-trips through JSON, so each GitHub Actions run can
 * load the previous frame, advance it a few dozen turns and commit the next one.
 * Nobody controls the daemon — it explores, fights, loots, levels up, dives
 * deeper and eventually dies, at which point a fresh daemon is forked.
 *
 * Runs unchanged in Node (the Action) and the browser (game/index.html).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Dungeon = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ------------------------------------------------------------- constants
  const VERSION = 1;
  const W = 53; // map columns
  const H = 17; // map rows
  const HUD = 22; // sidebar columns (1 space gutter each side)
  const LOG_LINES = 7; // log tail rendered under the frame
  const LOG_KEEP = 40; // log entries persisted in state
  const FLOOR_BUDGET = 700; // turns before the daemon stops exploring and heads for the stairs
  const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

  // Per-depth monster growth, tuned by simulation: a daemon usually dies around
  // depth 7 (p90 ≈ 20) after ~1,600 turns. Bosses scale more gently.
  const BALANCE = { hp: 0.3, atk: 1.1, def: 3, boss: 0.4 };

  // Every depth is a directory; past /root the daemon is in the void.
  const PATHS = ['/home', '/usr/src', '/usr/lib', '/var/log', '/proc', '/sys', '/dev', '/boot', '/etc/init.d', '/root'];

  const MONSTERS = {
    b: { name: 'bug', hp: 5, atk: 3, def: 0, xp: 3, min: 1 },
    x: { name: 'off_by_one', hp: 7, atk: 3, def: 0, xp: 5, min: 1, miss: 0.25 },
    n: { name: 'null_pointer', hp: 9, atk: 5, def: 1, xp: 8, min: 2 },
    l: { name: 'memory_leak', hp: 14, atk: 3, def: 1, xp: 10, min: 3, regen: 1 },
    r: { name: 'race_condition', hp: 10, atk: 4, def: 1, xp: 12, min: 3, speed: 2 },
    z: { name: 'zombie_process', hp: 18, atk: 6, def: 2, xp: 15, min: 4, revive: 0.35 },
    H: { name: 'heisenbug', hp: 15, atk: 7, def: 2, xp: 20, min: 5, blink: 0.3 },
    S: { name: 'segfault', hp: 26, atk: 8, def: 3, xp: 30, min: 6, crit: 0.2 },
    D: { name: 'deadlock', hp: 60, atk: 9, def: 4, xp: 120, min: Infinity, boss: true, lock: 0.2 },
  };

  // Weapons are debugging tools, armour is whatever safety net you can find.
  const TOOLS = [['printf', 0], ['grep', 2], ['gdb', 4], ['strace', 6], ['valgrind', 8], ['perf', 10], ['rr', 13], ['ebpf', 16]];
  const GUARDS = [['no_tests', 0], ['linter', 1], ['unit_tests', 2], ['type_system', 3], ['ci_pipeline', 4], ['fuzzer', 6], ['formal_proof', 8]];

  const EXIT_CODES = {
    segfault: '139 SIGSEGV',
    null_pointer: '139 SIGSEGV',
    deadlock: '137 SIGKILL',
    memory_leak: '137 OOM-killed',
    race_condition: '134 SIGABRT',
  };

  // Box-drawing glyph for a wall, indexed by connected neighbours N|E<<1|S<<2|W<<3.
  const WALL = ['─', '│', '─', '└', '│', '│', '┌', '├', '─', '┘', '─', '┴', '┐', '┤', '┬', '┼'];

  // ------------------------------------------------------------------- rng
  // mulberry32 over w.rng so the generator state survives serialisation.
  function rand(w) {
    let t = (w.rng = (w.rng + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const ri = (w, a, b) => a + Math.floor(rand(w) * (b - a + 1));

  // --------------------------------------------------------------- helpers
  const idx = (x, y) => y * W + x;
  const inMap = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const walkable = (t) => t === '.' || t === ',' || t === '+' || t === '>';
  const wallish = (t) => t === '#' || t === '+';
  const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const pad = (n, len) => String(n).padStart(len, '0');
  const pathFor = (depth) =>
    depth <= PATHS.length ? PATHS[depth - 1] : `/dev/null/${((depth * 2654435761) >>> 0).toString(16).slice(0, 4)}`;
  const xpNeed = (lvl) => Math.round(12 * Math.pow(lvl, 1.55));
  const atkOf = (h) => h.atk + TOOLS[h.tool][1];
  const defOf = (h) => h.def + GUARDS[h.guard][1];
  const monsterAt = (w, x, y) => w.monsters.find((m) => m.x === x && m.y === y);
  const itemAt = (w, x, y) => w.items.find((it) => it.x === x && it.y === y);
  const isVisible = (w, e) => w.visible[idx(e.x, e.y)] === 1;

  function log(w, c, tag, m) {
    w.log.push({ t: w.turn, c, tag, m });
    if (w.log.length > LOG_KEEP) w.log.splice(0, w.log.length - LOG_KEEP);
  }

  // Breadth-first distances over walkable tiles (monsters ignored).
  function flood(tiles, sx, sy) {
    const dist = new Int16Array(W * H).fill(-1);
    const q = [idx(sx, sy)];
    dist[q[0]] = 0;
    for (let qi = 0; qi < q.length; qi++) {
      const u = q[qi], ux = u % W, uy = (u / W) | 0;
      for (const [dx, dy] of DIRS) {
        const vx = ux + dx, vy = uy + dy;
        if (!inMap(vx, vy)) continue;
        const v = idx(vx, vy);
        if (dist[v] !== -1 || !walkable(tiles[vy][vx])) continue;
        dist[v] = dist[u] + 1;
        q.push(v);
      }
    }
    return dist;
  }

  // ------------------------------------------------------------ generation
  // Dijkstra corridor carver: digs through rock, enters rooms only through the
  // middle of a wall (never corners, never sliding along one) and prefers to
  // reuse existing corridors, so floors read like hand-drawn maps.
  function carve(grid, side, from, to) {
    const N = W * H;
    const cost = new Float64Array(N).fill(Infinity);
    const prev = new Int32Array(N).fill(-1);
    const done = new Uint8Array(N);
    const start = idx(from.x, from.y), goal = idx(to.x, to.y);
    cost[start] = 0;
    for (;;) {
      let u = -1, best = Infinity;
      for (let i = 0; i < N; i++) if (!done[i] && cost[i] < best) { best = cost[i]; u = i; }
      if (u === -1) return false;
      if (u === goal) break;
      done[u] = 1;
      const ux = u % W, uy = (u / W) | 0;
      const fromWall = wallish(grid[uy][ux]);
      for (const [dx, dy] of DIRS) {
        const vx = ux + dx, vy = uy + dy;
        if (vx < 1 || vy < 1 || vx > W - 2 || vy > H - 2) continue;
        const v = idx(vx, vy), t = grid[vy][vx];
        let c;
        if (wallish(t)) {
          if (fromWall || side[v] === 3) continue;
          if (side[v] === 1 && dx !== 0) continue; // horizontal wall: enter vertically
          if (side[v] === 2 && dy !== 0) continue; // vertical wall: enter horizontally
          c = t === '+' ? 1 : 5;
        } else if (t === ' ') {
          const hugs = DIRS.some(([ex, ey]) => grid[vy + ey][vx + ex] === '#');
          c = hugs ? 6 : 2;
        } else {
          c = 1;
        }
        if (cost[u] + c < cost[v]) { cost[v] = cost[u] + c; prev[v] = u; }
      }
    }
    for (let v = goal; v !== -1; v = prev[v]) {
      const x = v % W, y = (v / W) | 0;
      if (grid[y][x] === ' ') grid[y][x] = ',';
      else if (grid[y][x] === '#') grid[y][x] = '+';
    }
    return true;
  }

  function generate(w) {
    for (let attempt = 0; attempt < 60; attempt++) {
      const grid = Array.from({ length: H }, () => Array(W).fill(' '));
      const side = new Uint8Array(W * H); // 1 horizontal wall, 2 vertical wall, 3 corner
      const rooms = [];
      for (let t = 0; t < 400 && rooms.length < 8; t++) {
        const rw = ri(w, 5, 12), rh = ri(w, 2, 5);
        const x = ri(w, 2, W - rw - 2), y = ri(w, 2, H - rh - 2);
        const clash = rooms.some(
          (r) => x - 1 <= r.x + r.w + 2 && r.x - 1 <= x + rw + 2 && y - 1 <= r.y + r.h + 2 && r.y - 1 <= y + rh + 2
        );
        if (!clash) rooms.push({ x, y, w: rw, h: rh });
      }
      if (rooms.length < 5) continue;

      for (const r of rooms) {
        for (let y = r.y - 1; y <= r.y + r.h; y++) {
          for (let x = r.x - 1; x <= r.x + r.w; x++) {
            const ex = x === r.x - 1 || x === r.x + r.w;
            const ey = y === r.y - 1 || y === r.y + r.h;
            grid[y][x] = ex || ey ? '#' : '.';
            side[idx(x, y)] = ex && ey ? 3 : ey ? 1 : ex ? 2 : 0;
          }
        }
      }

      rooms.sort((a, b) => a.x + a.w / 2 - (b.x + b.w / 2));
      const links = [];
      for (let i = 0; i + 1 < rooms.length; i++) links.push([i, i + 1]);
      for (let e = ri(w, 1, 2); e > 0; e--) {
        const i = ri(w, 0, rooms.length - 3);
        links.push([i, i + 2]);
      }
      const inside = (r) => ({ x: ri(w, r.x, r.x + r.w - 1), y: ri(w, r.y, r.y + r.h - 1) });
      if (!links.every(([a, b]) => carve(grid, side, inside(rooms[a]), inside(rooms[b])))) continue;

      const dist = flood(grid, rooms[0].x, rooms[0].y);
      if (rooms.every((r) => dist[idx(r.x, r.y)] >= 0)) return { grid, rooms };
    }
    throw new Error('dungeon generation failed');
  }

  function freeFloor(w, grid, room) {
    for (let t = 0; t < 40; t++) {
      const x = ri(w, room.x, room.x + room.w - 1), y = ri(w, room.y, room.y + room.h - 1);
      const h = w.hero;
      if (grid[y][x] !== '.' || monsterAt(w, x, y) || itemAt(w, x, y) || (h.x === x && h.y === y)) continue;
      return { x, y };
    }
    return null;
  }

  function pickMonster(w) {
    const pool = [];
    for (const [k, m] of Object.entries(MONSTERS)) {
      if (m.min > w.depth) continue;
      const weight = w.depth - m.min <= 3 ? 3 : 1;
      for (let i = 0; i < weight; i++) pool.push(k);
    }
    return pool[ri(w, 0, pool.length - 1)];
  }

  function spawnMonster(w, k, at) {
    const b = MONSTERS[k], d = (w.depth - 1) * (b.boss ? BALANCE.boss : 1);
    const hp = Math.round(b.hp * (1 + BALANCE.hp * d));
    w.monsters.push({
      id: w.nextId++, k, x: at.x, y: at.y, hp, maxHp: hp,
      atk: b.atk + Math.floor(d * BALANCE.atk), def: b.def + Math.floor(d / BALANCE.def), awake: false,
    });
  }

  function gearTier(w, list) {
    const t = 1 + Math.floor((w.depth - 1) / 2) + (rand(w) < 0.35 ? 1 : 0);
    return Math.max(1, Math.min(list.length - 1, t));
  }

  function newFloor(w) {
    const { grid, rooms } = generate(w);
    const h = w.hero;
    w.rooms = rooms;
    w.monsters = [];
    w.items = [];
    h.x = h.y = -1;

    const start = ri(w, 0, rooms.length - 1);
    const spawn = freeFloor(w, grid, rooms[start]) || { x: rooms[start].x, y: rooms[start].y };
    h.x = spawn.x;
    h.y = spawn.y;

    // Stairs go in the room furthest (by walking distance) from the spawn.
    const dist = flood(grid, h.x, h.y);
    let far = start;
    rooms.forEach((r, i) => {
      if (i !== start && dist[idx(r.x, r.y)] > dist[idx(rooms[far].x, rooms[far].y)]) far = i;
    });
    const stairs = freeFloor(w, grid, rooms[far]);
    if (stairs) grid[stairs.y][stairs.x] = '>';

    const others = rooms.filter((_, i) => i !== start);
    const count = Math.min(3 + w.depth, 10);
    for (let i = 0; i < count; i++) {
      const at = freeFloor(w, grid, others[ri(w, 0, others.length - 1)]);
      if (at) spawnMonster(w, pickMonster(w), at);
    }
    if (w.depth % 5 === 0) {
      const at = freeFloor(w, grid, rooms[far]);
      if (at) spawnMonster(w, 'D', at);
    }

    const loot = ['!', '!', '!', '*', '*', '*', ')', ')', '[', '[', '?'];
    for (let i = ri(w, 3, 5); i > 0; i--) {
      const at = freeFloor(w, grid, rooms[ri(w, 0, rooms.length - 1)]);
      if (!at) continue;
      const k = loot[ri(w, 0, loot.length - 1)];
      const v = k === '*' ? ri(w, 3, 9) * w.depth : k === ')' ? gearTier(w, TOOLS) : k === '[' ? gearTier(w, GUARDS) : 0;
      w.items.push({ k, x: at.x, y: at.y, v });
    }

    w.tiles = grid.map((row) => row.join(''));
    w.seen = new Uint8Array(W * H);
    w.floorTurn = 0;
    updateFov(w);
  }

  // ------------------------------------------------------------ world/run
  function spawnHero(w) {
    w.run += 1;
    w.depth = 1;
    w.hero = {
      x: 0, y: 0, hp: 30, maxHp: 30, atk: 4, def: 1, lvl: 1, xp: 0,
      tool: 0, guard: 0, potions: 1, stars: 0, kills: 0,
      pid: ri(w, 1024, 32767), born: w.turn, mode: 'booting', stun: 0, resting: false, lastHit: null,
    };
    newFloor(w);
    if (w.records.bestDepth < 1) { w.records.bestDepth = 1; w.records.bestRun = w.run; }
    log(w, '#', 'fork', `daemon #${w.run} spawned in ${pathFor(1)} · pid ${w.hero.pid}`);
  }

  function create(seed) {
    const w = {
      v: VERSION, seed: seed >>> 0, rng: seed >>> 0, tick: 0, turn: 0,
      run: 0, depth: 1, floorTurn: 0, nextId: 1,
      tiles: [], seen: null, visible: null, rooms: [], monsters: [], items: [],
      hero: null, log: [], graveyard: [],
      records: { bestDepth: 0, bestRun: 0, deaths: 0, kills: 0 },
    };
    spawnHero(w);
    return w;
  }

  function updateFov(w) {
    const vis = new Uint8Array(W * H);
    const h = w.hero;
    const room = w.rooms.find((r) => h.x >= r.x - 1 && h.x <= r.x + r.w && h.y >= r.y - 1 && h.y <= r.y + r.h);
    if (room) {
      for (let y = room.y - 1; y <= room.y + room.h; y++)
        for (let x = room.x - 1; x <= room.x + room.w; x++) vis[idx(x, y)] = 1;
    }
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) if (inMap(h.x + dx, h.y + dy)) vis[idx(h.x + dx, h.y + dy)] = 1;
    for (let i = 0; i < vis.length; i++) if (vis[i]) w.seen[i] = 1;
    w.visible = vis;
  }

  // ---------------------------------------------------------------- combat
  function gainXp(w, n) {
    const h = w.hero;
    h.xp += n;
    while (h.xp >= xpNeed(h.lvl)) {
      h.xp -= xpNeed(h.lvl);
      h.lvl += 1;
      const g = 5 + ri(w, 1, 4);
      h.maxHp += g;
      h.atk += 1;
      if (h.lvl % 2 === 0) h.def += 1;
      h.hp = Math.min(h.maxHp, h.hp + Math.ceil(h.maxHp / 3));
      log(w, '!', 'lvlup', `daemon reached lvl ${h.lvl} · +${g} max hp`);
    }
  }

  function slay(w, m, crit) {
    const k = MONSTERS[m.k], h = w.hero;
    if (k.revive && !m.revived && rand(w) < k.revive) {
      m.revived = true;
      m.hp = Math.ceil(m.maxHp / 2);
      log(w, '#', 'revive', `${k.name} re-parented to init · back for more`);
      return;
    }
    w.monsters = w.monsters.filter((o) => o !== m);
    const xp = Math.round(k.xp * (1 + 0.15 * (w.depth - 1)));
    h.kills += 1;
    w.records.kills += 1;
    log(w, '+', 'kill', `${k.boss ? 'resolved' : 'squashed'} ${k.name} · +${xp} xp${crit ? ' · critical' : ''}`);
    gainXp(w, xp);
    if (k.boss) w.items.push({ k: ')', x: m.x, y: m.y, v: Math.min(TOOLS.length - 1, gearTier(w, TOOLS) + 1) });
    else if (rand(w) < 0.12) w.items.push({ k: rand(w) < 0.5 ? '!' : '*', x: m.x, y: m.y, v: ri(w, 3, 9) * w.depth });
  }

  function blink(w, m) {
    for (let t = 0; t < 20; t++) {
      const x = m.x + ri(w, -4, 4), y = m.y + ri(w, -3, 3);
      if (!inMap(x, y) || !walkable(w.tiles[y][x]) || monsterAt(w, x, y) || (x === w.hero.x && y === w.hero.y)) continue;
      m.x = x;
      m.y = y;
      if (!m.blinked) log(w, '#', 'blink', `${MONSTERS[m.k].name} moved when observed`);
      m.blinked = true;
      return;
    }
  }

  function strike(w, m) {
    const k = MONSTERS[m.k], h = w.hero;
    m.awake = true;
    if (k.blink && rand(w) < k.blink) return blink(w, m);
    const crit = rand(w) < 0.1;
    const dmg = Math.max(1, atkOf(h) + ri(w, -1, 2) - m.def) * (crit ? 2 : 1);
    m.hp -= dmg;
    if (m.hp <= 0) slay(w, m, crit);
  }

  function bite(w, m) {
    const k = MONSTERS[m.k], h = w.hero;
    if (k.miss && rand(w) < k.miss) return;
    const crit = rand(w) < (k.crit || 0.05);
    let dmg = m.atk + ri(w, -1, 2) - defOf(h);
    if (crit) dmg = Math.round(m.atk * 1.8) - defOf(h);
    dmg = Math.max(rand(w) < 0.5 ? 1 : 0, dmg);
    h.hp -= dmg;
    h.lastHit = m.k;
    if (dmg > 0 && (crit || dmg >= h.maxHp * 0.2)) {
      log(w, '-', 'hit', `${k.name} hit for ${dmg}${crit ? ' · critical' : ''} · hp ${Math.max(0, h.hp)}/${h.maxHp}`);
    }
    if (k.lock && h.hp > 0 && rand(w) < k.lock) {
      h.stun = 1;
      log(w, '#', 'lock', `${k.name} grabbed the mutex · daemon blocked`);
    }
  }

  // ----------------------------------------------------------------- items
  function pickup(w) {
    const h = w.hero;
    const it = itemAt(w, h.x, h.y);
    if (!it) return;
    w.items = w.items.filter((o) => o !== it);
    if (it.k === '!') {
      if (h.potions < 3) {
        h.potions += 1;
        log(w, '+', 'loot', `stashed a hotfix (${h.potions}/3)`);
      } else {
        h.hp = Math.min(h.maxHp, h.hp + 8);
        log(w, '+', 'loot', 'applied a spare hotfix on the spot');
      }
    } else if (it.k === '*') {
      h.stars += it.v;
      log(w, '+', 'loot', `collected ${it.v} stars`);
    } else if (it.k === ')' || it.k === '[') {
      const list = it.k === ')' ? TOOLS : GUARDS, slot = it.k === ')' ? 'tool' : 'guard';
      const stat = it.k === ')' ? 'atk' : 'def';
      if (it.v > h[slot]) {
        log(w, '!', 'equip', `${list[it.v][0]} (+${list[it.v][1]} ${stat}) replaces ${list[h[slot]][0]}`);
        h[slot] = it.v;
      } else {
        const v = 5 + it.v * 5;
        h.stars += v;
        log(w, '#', 'salvage', `scrapped a spare ${list[it.v][0]} for ${v} stars`);
      }
    } else if (it.k === '?') {
      // Pure XP: revealing the floor made the map jump and cut exploration short.
      const xp = 6 * w.depth;
      log(w, '!', 'docs', `read the docs · +${xp} xp`);
      gainXp(w, xp);
    }
  }

  // -------------------------------------------------------------------- ai
  // BFS over tiles the daemon has already seen; returns the first step toward
  // the nearest tile satisfying `goal`, or null.
  function firstStep(w, goal) {
    const h = w.hero;
    const start = idx(h.x, h.y);
    const prev = new Int32Array(W * H).fill(-1);
    prev[start] = start;
    const q = [start];
    for (let qi = 0; qi < q.length; qi++) {
      const u = q[qi], ux = u % W, uy = (u / W) | 0;
      if (u !== start && goal(ux, uy)) {
        let v = u;
        while (prev[v] !== start) v = prev[v];
        return { x: v % W, y: (v / W) | 0 };
      }
      for (const [dx, dy] of DIRS) {
        const vx = ux + dx, vy = uy + dy;
        if (!inMap(vx, vy)) continue;
        const v = idx(vx, vy);
        if (prev[v] !== -1 || !w.seen[v] || !walkable(w.tiles[vy][vx])) continue;
        const m = monsterAt(w, vx, vy); // only monsters the daemon can see are obstacles
        if (m && isVisible(w, m) && !goal(vx, vy)) continue;
        prev[v] = u;
        q.push(v);
      }
    }
    return null;
  }

  function frontier(w, x, y) {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) if (inMap(x + dx, y + dy) && !w.seen[idx(x + dx, y + dy)]) return true;
    return false;
  }

  function walk(w, s) {
    const m = monsterAt(w, s.x, s.y);
    if (m) return strike(w, m);
    w.hero.x = s.x;
    w.hero.y = s.y;
    pickup(w);
  }

  function descend(w, shortcut) {
    const h = w.hero;
    w.depth += 1;
    h.hp = Math.min(h.maxHp, h.hp + Math.ceil(h.maxHp / 4));
    log(w, '@@', 'deploy', `${shortcut ? 'followed a symlink' : 'deployed'} → depth ${pad(w.depth, 2)} ${pathFor(w.depth)}`);
    if (w.depth > w.records.bestDepth) {
      w.records.bestDepth = w.depth;
      w.records.bestRun = w.run;
    }
    newFloor(w);
    h.mode = 'deploying';
  }

  function heroTurn(w) {
    const h = w.hero;
    if (h.stun > 0) { h.stun -= 1; h.mode = 'blocked'; return; }

    const inView = w.monsters.filter((m) => isVisible(w, m));
    const awake = inView.filter((m) => m.awake);
    const near = (list) => (x, y) => list.some((m) => m.x === x && m.y === y);

    if (awake.length && h.hp < h.maxHp * 0.35 && h.potions > 0) {
      h.potions -= 1;
      const v = Math.ceil(h.maxHp * 0.4) + 5;
      h.hp = Math.min(h.maxHp, h.hp + v);
      h.mode = 'patching';
      log(w, '!', 'heal', `applied a hotfix · +${v} hp`);
      return;
    }

    const adjacent = inView.filter((m) => manhattan(m, h) === 1).sort((a, b) => a.hp - b.hp);
    if (adjacent.length) { h.mode = 'fighting'; return strike(w, adjacent[0]); }

    if (awake.length) {
      const s = firstStep(w, near(awake));
      if (s) { h.mode = 'fighting'; return walk(w, s); }
    }

    if (awake.length) h.resting = false;
    else if (h.hp < h.maxHp * 0.5) h.resting = true;
    else if (h.hp >= h.maxHp * 0.9) h.resting = false;
    if (h.resting) { h.mode = 'resting'; return; }

    if (inView.length) {
      const s = firstStep(w, near(inView));
      if (s) { h.mode = 'hunting'; return walk(w, s); }
    }

    if (w.floorTurn < FLOOR_BUDGET) {
      const loot = firstStep(w, (x, y) => !!itemAt(w, x, y));
      if (loot) { h.mode = 'looting'; return walk(w, loot); }
      const out = firstStep(w, (x, y) => frontier(w, x, y));
      if (out) { h.mode = 'exploring'; return walk(w, out); }
    }

    if (w.tiles[h.y][h.x] === '>') return descend(w, false);
    const stairs = firstStep(w, (x, y) => w.tiles[y][x] === '>');
    if (stairs) { h.mode = 'deploying'; return walk(w, stairs); }
    if (w.floorTurn > FLOOR_BUDGET * 1.5) return descend(w, true);
    h.mode = 'idle';
  }

  function monstersTurn(w) {
    const h = w.hero;
    const dist = flood(w.tiles, h.x, h.y);
    for (const m of w.monsters) {
      const k = MONSTERS[m.k];
      if (!m.awake) {
        if (isVisible(w, m) && rand(w) < 0.6) m.awake = true;
        else continue;
      }
      if (k.regen && m.hp < m.maxHp) m.hp = Math.min(m.maxHp, m.hp + k.regen);
      for (let a = 0; a < (k.speed || 1) && h.hp > 0; a++) {
        if (manhattan(m, h) === 1) { bite(w, m); continue; }
        const here = dist[idx(m.x, m.y)];
        if (here < 0 || here > 40) break;
        for (const [dx, dy] of DIRS) {
          const nx = m.x + dx, ny = m.y + dy;
          if (!inMap(nx, ny)) continue;
          const d = dist[idx(nx, ny)];
          if (d >= 0 && d < here && !monsterAt(w, nx, ny)) { m.x = nx; m.y = ny; break; }
        }
      }
      if (h.hp <= 0) return;
    }
  }

  function die(w) {
    const h = w.hero;
    const killer = h.lastHit ? MONSTERS[h.lastHit].name : 'unknown';
    log(w, '-', 'exit', `daemon #${w.run} killed by ${killer} in ${pathFor(w.depth)} · exit ${EXIT_CODES[killer] || '1'}`);
    w.graveyard.unshift({
      run: w.run, depth: w.depth, path: pathFor(w.depth), lvl: h.lvl, kills: h.kills,
      stars: h.stars, killer, turns: w.turn - h.born,
    });
    w.graveyard.length = Math.min(w.graveyard.length, 6);
    w.records.deaths += 1;
    spawnHero(w);
  }

  function step(w) {
    const h = w.hero;
    w.turn += 1;
    w.floorTurn += 1;
    const depth = w.depth;
    updateFov(w);
    heroTurn(w);
    if (w.depth !== depth) return; // fresh floor: nothing has noticed the daemon yet
    updateFov(w);
    monstersTurn(w);
    if (h.hp <= 0) return die(w);
    if (!w.monsters.some((m) => m.awake && isVisible(w, m))) {
      if (w.turn % (h.resting ? 2 : 5) === 0) h.hp = Math.min(h.maxHp, h.hp + 1 + Math.floor(h.lvl / 6));
    }
  }

  // `onTurn(w)` sees the world after every turn (used to record the replay).
  // Refreshing the FOV first is idempotent, so recording never alters the run.
  function tick(w, turns, onTurn) {
    w.tick += 1;
    for (let i = 0; i < turns; i++) {
      step(w);
      if (onTurn) { updateFov(w); onTurn(w); }
    }
    updateFov(w);
    return w;
  }

  // ---------------------------------------------------------- persistence
  function serialize(w) {
    const { visible, seen, ...rest } = w;
    const rows = [];
    for (let y = 0; y < H; y++) {
      let row = '';
      for (let x = 0; x < W; x++) row += seen[idx(x, y)] ? '1' : '0';
      rows.push(row);
    }
    return { ...rest, seen: rows };
  }

  function hydrate(o) {
    if (!o || o.v !== VERSION || !Array.isArray(o.tiles) || o.tiles.length !== H || o.tiles[0].length !== W) return null;
    const w = { ...o, seen: new Uint8Array(W * H) };
    o.seen.forEach((row, y) => {
      for (let x = 0; x < W; x++) w.seen[idx(x, y)] = row[x] === '1' ? 1 : 0;
    });
    updateFov(w);
    return w;
  }

  // ------------------------------------------------------------- rendering
  function wallGlyph(w, x, y) {
    let mask = 0;
    DIRS.forEach(([dx, dy], bit) => {
      const nx = x + dx, ny = y + dy;
      if (inMap(nx, ny) && w.seen[idx(nx, ny)] && wallish(w.tiles[ny][nx])) mask |= 1 << bit;
    });
    return WALL[mask];
  }

  function mapRows(w) {
    const h = w.hero;
    const rows = [];
    for (let y = 0; y < H; y++) {
      let row = '';
      for (let x = 0; x < W; x++) {
        const i = idx(x, y);
        if (!w.seen[i]) { row += ' '; continue; }
        if (x === h.x && y === h.y) { row += '@'; continue; }
        const m = w.visible[i] ? monsterAt(w, x, y) : null;
        if (m) { row += m.k; continue; }
        const it = itemAt(w, x, y);
        if (it) { row += it.k; continue; }
        const t = w.tiles[y][x];
        row += t === '#' ? wallGlyph(w, x, y) : t === '+' ? '+' : t === ',' ? '░' : t === '.' ? '·' : t === '>' ? '>' : ' ';
      }
      rows.push(row);
    }
    return rows;
  }

  function bar(v, max, n) {
    const f = Math.max(0, Math.min(n, Math.round((v / max) * n)));
    return '█'.repeat(f) + '░'.repeat(n - f);
  }

  function hudRows(w) {
    const h = w.hero, C = HUD - 2;
    const row = (l = '', r = '') => ' ' + (l + ' '.repeat(Math.max(1, C - l.length - r.length)) + r).slice(0, C).padEnd(C) + ' ';
    const blank = () => ' '.repeat(HUD);
    const inView = w.monsters.filter((m) => isVisible(w, m)).sort((a, b) => manhattan(a, h) - manhattan(b, h));
    const tool = TOOLS[h.tool], guard = GUARDS[h.guard];
    const rows = [
      row(`DAEMON #${pad(w.run, 3)}`, `lvl ${pad(h.lvl, 2)}`),
      row(`pid ${h.pid}`, h.mode),
      blank(),
      row(`HP ${bar(h.hp, h.maxHp, 9)}`, `${Math.max(0, h.hp)}/${h.maxHp}`),
      row(`XP ${bar(h.xp, xpNeed(h.lvl), 9)}`, `${Math.floor((100 * h.xp) / xpNeed(h.lvl))}%`),
      blank(),
      row(`atk ${pad(atkOf(h), 2)}`, `def ${pad(defOf(h), 2)}`),
      row(`) ${tool[0]}`, `+${tool[1]}`),
      row(`[ ${guard[0]}`, `+${guard[1]}`),
      row('! hotfix', `x${h.potions}`),
      row('* stars', String(h.stars)),
      blank(),
      row(`depth ${pad(w.depth, 2)}`, `kills ${pad(h.kills, 3)}`),
      blank(),
      row('in view', inView.length ? String(inView.length) : 'clear'),
    ];
    for (const m of inView.slice(0, H - rows.length)) rows.push(row(`${m.k} ${MONSTERS[m.k].name}`, bar(m.hp, m.maxHp, 3)));
    while (rows.length < H) rows.push(blank());
    return rows;
  }

  function mappedPct(w) {
    let total = 0, known = 0;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (!walkable(w.tiles[y][x])) continue;
        total += 1;
        if (w.seen[idx(x, y)]) known += 1;
      }
    return total ? Math.round((100 * known) / total) : 0;
  }

  function logLine(e) {
    const body = `${pad(e.t, 6)}  ${e.tag.padEnd(7)} ${e.m}`;
    return e.c === '@@' ? `@@ ${body} @@` : `${e.c} ${body}`;
  }

  function statusLine(w) {
    const r = w.records;
    return `${pathFor(w.depth)} ${mappedPct(w)}% mapped · record depth ${pad(r.bestDepth, 2)} by #${pad(r.bestRun, 3)} · ${r.deaths} daemon${r.deaths === 1 ? '' : 's'} lost`;
  }

  // Plain, render-ready copy of everything one frame shows. The SVG replay
  // records one of these per turn.
  function snapshot(w) {
    const h = w.hero;
    return {
      turn: w.turn, run: w.run, depth: w.depth, path: pathFor(w.depth), floor: `${w.run}/${w.depth}`,
      tiles: w.tiles, seen: Uint8Array.from(w.seen),
      hero: {
        x: h.x, y: h.y, hp: Math.max(0, h.hp), maxHp: h.maxHp, xp: h.xp, need: xpNeed(h.lvl), lvl: h.lvl,
        mode: h.mode, pid: h.pid, atk: atkOf(h), def: defOf(h), potions: h.potions, stars: h.stars, kills: h.kills,
        tool: TOOLS[h.tool], guard: GUARDS[h.guard],
      },
      monsters: w.monsters
        .filter((m) => isVisible(w, m))
        .map((m) => ({ id: m.id, k: m.k, name: MONSTERS[m.k].name, x: m.x, y: m.y, hp: m.hp, maxHp: m.maxHp })),
      items: w.items.filter((it) => w.seen[idx(it.x, it.y)]).map((it) => ({ k: it.k, x: it.x, y: it.y })),
      log: w.log.slice(-LOG_LINES).map((e) => ({ c: e.c, text: logLine(e) })),
      status: statusLine(w),
    };
  }

  // The frame is designed for a ```diff fence: the header renders purple, the
  // box renders as plain context lines and every log line gets its own colour.
  function frame(w) {
    const map = mapRows(w), hud = hudRows(w);
    const inner = W + HUD + 1;
    const status = ` ${statusLine(w)}`;
    const lines = [
      `@@ /dev/dungeon · daemon #${pad(w.run, 3)} · depth ${pad(w.depth, 2)} ${pathFor(w.depth)} · turn ${pad(w.turn, 6)} @@`,
      ` ┌${'─'.repeat(W)}┬${'─'.repeat(HUD)}┐`,
      ...map.map((m, y) => ` │${m}│${hud[y]}│`),
      ` ├${'─'.repeat(W)}┴${'─'.repeat(HUD)}┤`,
      ` │${status.slice(0, inner).padEnd(inner)}│`,
      ` └${'─'.repeat(inner)}┘`,
      ...w.log.slice(-LOG_LINES).map(logLine),
    ];
    return lines;
  }

  return {
    VERSION, W, H, MONSTERS, TOOLS, GUARDS,
    create, tick, step, serialize, hydrate, frame, snapshot, pathFor,
  };
});
