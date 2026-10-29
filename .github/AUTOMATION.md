# 🤖 Self-updating README

The profile README rebuilds itself every 30 minutes: live GitHub data, plus one new frame of **/dev/dungeon**, a zero-player roguelike that is simulated and rendered entirely by GitHub Actions. No manual edits are needed.

## 📁 Structure

```
.github/
├── workflows/
│   └── update-readme.yml     # every 30 min: refresh data → advance the game → commit
└── scripts/
    ├── update-readme.js      # GitHub API → stats, languages, repos, stack
    └── tick-dungeon.js       # loads the world, simulates 400 turns, renders the replay

game/
├── engine.js                 # /dev/dungeon: generation, AI, combat, text frame (vanilla JS, UMD)
├── replay.js                 # turns per-turn snapshots into the auto-playing SVG
└── state.json                # the persisted world: map, RNG state, daemon, monsters, log

assets/
├── hero-3d.svg               # custom header banner
└── lang-dist.svg             # generated language bar (rewritten each run)
```

## ⚙️ How It Works

### 🕐 Schedule
- **Every 30 minutes** at :11 and :41 (`11,41 * * * *`, off the top-of-the-hour rush). GitHub can delay or drop scheduled runs under load; the replay keeps looping until the next frame lands.
- **On every push to `main`**
- **Manually** via *Actions* → “Refresh Profile README” → *Run workflow*

Bot commits are pushed with `GITHUB_TOKEN`, which never re-triggers workflows, so there is no loop.

### 🔄 Live data (`update-readme.js`)

The script calls the GitHub API and rewrites the content between marker comments in `README.md`:

| Marker section              | Live data                                                       |
| --------------------------- | --------------------------------------------------------------- |
| `<!-- GH:STATS:... -->`     | Repositories, stars, forks, followers (+ contribution stats)    |
| `<!-- GH:LANGUAGES:... -->` | Top languages, accurate percentages, and an animated share bar  |
| `<!-- GH:TOP_REPOS:... -->` | Most-starred repositories with live stars, forks, and language  |
| `<!-- GH:RECENT:... -->`    | Recently pushed projects with language and relative update time |
| `<!-- GH:TECH:... -->`      | Stack icons (skillicons) derived from detected languages        |

This step runs with `continue-on-error`, so a GitHub API hiccup leaves the data as it was and never blocks the game.

### 🎮 /dev/dungeon (`tick-dungeon.js` + `game/engine.js`)

GitHub strips `<script>`, `<style>`, `class` and `style` from READMEs, so nothing can execute on the page. The game therefore runs **server-side, one frame per workflow run**, and motion comes from a replay:

```
game/state.json ──▶ engine.tick(world, 400) ─▶ game/state.json
                          │ snapshot per turn
                          ├──▶ replay.js ──▶ dungeon.svg on the output branch (~100 s loop)
                          └──▶ README.md  <!-- DUNGEON:START --> … <!-- DUNGEON:END -->
```

- **Auto-playing replay:** every turn of the run is recorded and rendered into `dungeon.svg` with discrete SMIL keyframes. The map reveals itself, the daemon and monsters move, hits flash, bars drain and the log scrolls. These are the real simulated turns, not a canned animation. Recording is side-effect free: the world evolves identically with or without it.
- **Output branch:** the replay (~200 KB) is rewritten every run, so the workflow force-pushes it as the only file on an orphan `output` branch, and the README loads it from `raw.githubusercontent.com/…/output/dungeon.svg?frame=N`. `main` only receives the small README and state diffs.

- **Zero-player:** the daemon `@` is driven by a priority AI (patch → fight → chase → rest → hunt → loot → explore → descend). Nobody controls it.
- **Procedural floors:** rooms plus Dijkstra-carved corridors that only enter rooms through mid-wall doors. Every depth is a directory (`/home` → `/usr/src` → … → `/root` → `/dev/null/…`).
- **Dev-themed bestiary:** bug, off_by_one, null_pointer, memory_leak, race_condition, zombie_process, heisenbug, segfault, and a deadlock boss every fifth depth. Weapons are debugging tools (`grep` → `ebpf`), armour is safety nets (`linter` → `formal_proof`).
- **Permadeath:** when the daemon dies it lands in the graveyard with its exit code, and a new daemon is forked.
- **Deterministic:** the mulberry32 PRNG state is saved with the world, so every frame is a pure function of the previous one.
- **Rendered as text:** a 79-column frame inside a `diff` fence. GitHub's own diff highlighter colours the log (`+` kills/loot, `-` damage/death, `!` level-ups/gear, `#` info, `@@` depth changes).
- **Balance:** tuned by offline simulation. A daemon typically dies around depth 7 (p90 ≈ 20) after roughly 1,500 turns (about 4 frames).

Tunables: `DUNGEON_TURNS` (turns per frame, default 400) and `DUNGEON_SEED` (seed for a brand-new world). Delete `game/state.json` to start a new world.

## 🛠️ Technical Details

- **Language:** Node.js 18+ (vanilla JavaScript, global `fetch`)
- **Dependencies:** none
- **Auth:** uses `GITHUB_TOKEN` for one-request GraphQL language aggregation, contribution stats and a higher API limit. Falls back to unauthenticated REST for local runs.
- **Permissions:** `contents: write` for committing changes.
- **Resilience:** if core data cannot be fetched, those sections are left unchanged rather than wiped. If `state.json` is missing or from an incompatible engine version, a new world is created.

## 🧪 Run Locally

```bash
# optional: raise rate limits / enable contribution stats
export GITHUB_TOKEN=ghp_xxx        # PowerShell: $env:GITHUB_TOKEN="ghp_xxx"
export GH_USERNAME=abhrajyoti-01   # defaults to abhrajyoti-01

npm run update-readme              # refresh live data
npm run tick                       # advance /dev/dungeon by one frame
DUNGEON_TURNS=400 npm run tick     # one long frame of 400 turns
```
