#!/usr/bin/env node
/**
 * -----------------------------------------------------------------------------
 *  /dev/dungeon — README game loop
 * -----------------------------------------------------------------------------
 *  Each GitHub Actions run is one "frame":
 *
 *    game/state.json ──▶ engine.tick(world, TURNS) ──▶ game/state.json
 *                                         └──────────▶ README.md (between markers)
 *
 *      <!-- DUNGEON:START -->  ...rendered frame...  <!-- DUNGEON:END -->
 *
 *  The simulation is deterministic (seeded PRNG stored in the state), so the
 *  world only moves when this script runs. No dependencies, Node 18+.
 * -----------------------------------------------------------------------------
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Dungeon = require('../../game/engine.js');

const ROOT = path.join(__dirname, '..', '..');
const STATE_PATH = path.join(ROOT, 'game', 'state.json');
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

function renderSection(world) {
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
  const r = world.records;

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
    '```diff',
    ...Dungeon.frame(world),
    '```',
    '',
    `<p align="center"><sub>frame <b>#${n(world.tick)}</b> · rendered ${stamp} UTC by GitHub Actions · ${TURNS} turns per frame · next frame within the hour</sub></p>`,
    '',
    '<details>',
    `<summary><b>Graveyard</b> · ${n(r.deaths)} daemon${r.deaths === 1 ? '' : 's'} lost · ${n(r.kills)} bugs squashed · deepest dive: depth ${r.bestDepth} by daemon #${r.bestRun}</summary>`,
    '<br />',
    '',
    graves,
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
  Dungeon.tick(world, TURNS);

  fs.writeFileSync(STATE_PATH, `${JSON.stringify(Dungeon.serialize(world), null, 1)}\n`);

  const readme = fs.readFileSync(README_PATH, 'utf8');
  const next = inject(readme, renderSection(world));
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
