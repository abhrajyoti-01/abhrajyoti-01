#!/usr/bin/env node
/**
 * -----------------------------------------------------------------------------
 *  /dev/dungeon — README game loop
 * -----------------------------------------------------------------------------
 *  Each GitHub Actions run is one "frame":
 *
 *    game/state.json ──▶ engine.tick(world, TURNS) ──▶ game/state.json
 *                              │ snapshot per turn
 *                              └──▶ assets/dungeon.svg (auto-playing replay)
 *                              └──▶ README.md (between markers)
 *
 *      <!-- DUNGEON:START -->  ...replay + text frame...  <!-- DUNGEON:END -->
 *
 *  READMEs can't run code, so the turns simulated here are replayed on loop
 *  by the SVG until the next run. Deterministic, no dependencies, Node 18+.
 * -----------------------------------------------------------------------------
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Dungeon = require('../../game/engine.js');
const { renderReplay } = require('../../game/replay.js');

const ROOT = path.join(__dirname, '..', '..');
const STATE_PATH = path.join(ROOT, 'game', 'state.json');
const REPLAY_PATH = path.join(ROOT, 'assets', 'dungeon.svg');
const README_PATH = path.join(ROOT, 'README.md');
const TURNS = Math.max(1, Math.min(500, Number(process.env.DUNGEON_TURNS) || 40));

function loadWorld() {
  try {
    const world = Dungeon.hydrate(JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')));
    if (world) return world;
    console.warn('⚠️  State is from an older engine — starting a new world.');
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('⚠️  Could not read state, starting a new world:', err.message);
  }
  const seed = Number(process.env.DUNGEON_SEED) || (Date.now() ^ 0x5eed) >>> 0;
  return Dungeon.create(seed);
}

function n(value) {
  return Number(value).toLocaleString('en-US');
}

function renderSection(world, first) {
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
  const r = world.records;
  const alt = `/dev/dungeon replay: daemon #${world.run} at depth ${world.depth} ${Dungeon.pathFor(world.depth)}, turns ${first} to ${world.turn}`;

  const graves = world.graveyard.length
    ? [
        '| daemon | reached | lvl | kills | killed by | uptime |',
        '| :-: | :-- | :-: | :-: | :-- | --: |',
        ...world.graveyard
          .slice(0, 5)
          .map(
            (g) =>
              `| \`#${String(g.run).padStart(3, '0')}\` | depth ${g.depth} · \`${g.path}\` | ${g.lvl} | ${g.kills} | \`${g.killer}\` | ${n(g.turns)} turns |`
          ),
      ].join('\n')
    : '_No daemon has died yet. Give it time._';

  return [
    `<p align="center"><img src="assets/dungeon.svg?frame=${world.tick}" width="100%" alt="${alt}" /></p>`,
    '',
    `<p align="center"><sub>↻ auto-playing the <b>${TURNS} turns</b> simulated in frame <b>#${n(world.tick)}</b> · rendered ${stamp} UTC by GitHub Actions · a new frame every hour</sub></p>`,
    '',
    '<details>',
    `<summary><b>Graveyard</b> · ${n(r.deaths)} daemon${r.deaths === 1 ? '' : 's'} lost · ${n(r.kills)} bug${r.kills === 1 ? '' : 's'} squashed · deepest dive: depth ${r.bestDepth} by daemon #${r.bestRun}</summary>`,
    '<br />',
    '',
    graves,
    '',
    '</details>',
    '',
    '<details>',
    '<summary><b>Current frame as plain text</b></summary>',
    '<br />',
    '',
    '```diff',
    ...Dungeon.frame(world),
    '```',
    '',
    '</details>',
  ].join('\n');
}

function inject(content, generated) {
  const start = '<!-- DUNGEON:START -->';
  const end = '<!-- DUNGEON:END -->';
  const a = content.indexOf(start);
  const b = content.indexOf(end);
  if (a === -1 || b === -1 || b < a) return null;
  return `${content.slice(0, a + start.length)}\n${generated}\n${content.slice(b)}`;
}

function main() {
  const world = loadWorld();
  const before = { run: world.run, depth: world.depth, turn: world.turn };
  const snaps = [Dungeon.snapshot(world)];
  Dungeon.tick(world, TURNS, (w) => snaps.push(Dungeon.snapshot(w)));

  fs.writeFileSync(STATE_PATH, `${JSON.stringify(Dungeon.serialize(world), null, 1)}\n`);
  fs.writeFileSync(REPLAY_PATH, renderReplay(snaps, { frame: world.tick }));

  const readme = fs.readFileSync(README_PATH, 'utf8');
  const next = inject(readme, renderSection(world, before.turn));
  if (next === null) {
    console.error('❌ DUNGEON markers not found in README.md — state saved, README untouched.');
    process.exit(1);
  }
  fs.writeFileSync(README_PATH, next);

  console.log(
    `🎮 frame #${world.tick}: turn ${before.turn} → ${world.turn} · daemon #${before.run} → #${world.run} · depth ${before.depth} → ${world.depth}`
  );
}

main();
