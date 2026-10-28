# 🤖 Self-updating README

The profile README rebuilds itself every hour: live GitHub data, plus one new frame of **/dev/dungeon**, a zero-player roguelike that is simulated and rendered entirely by GitHub Actions. No manual edits are needed.

## 📁 Structure

```
.github/
├── workflows/
│   └── update-readme.yml     # hourly job: refresh data → advance the game → commit
└── scripts/
    ├── update-readme.js      # GitHub API → stats, languages, repos, stack
    └── tick-dungeon.js       # loads the world, simulates 40 turns, renders the frame

game/
├── engine.js                 # /dev/dungeon: generation, AI, combat, renderer (vanilla JS, UMD)
└── state.json                # the persisted world: map, RNG state, daemon, monsters, log

assets/
├── hero-3d.svg               # custom header banner
└── lang-dist.svg             # generated language bar (rewritten each run)
```

## ⚙️ How It Works

### 🕐 Schedule
- **Hourly** at minute 17 (`17 * * * *`, off the top-of-the-hour rush)
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

GitHub strips `<script>`, `<style>`, `class` and `style` from READMEs, so nothing can execute on the page. The game therefore runs **server-side, one frame per workflow run**:

```
game/state.json ──▶ engine.tick(world, 40) ──▶ game/state.json
                                     └───────▶ README.md  <!-- DUNGEON:START --> … <!-- DUNGEON:END -->
```

- **Zero-player:** the daemon `@` is driven by a priority AI (patch → fight → chase → rest → hunt → loot → explore → descend). Nobody controls it.
- **Procedural floors:** rooms plus Dijkstra-carved corridors that only enter rooms through mid-wall doors. Every depth is a directory (`/home` → `/usr/src` → … → `/root` → `/dev/null/…`).
- **Dev-themed bestiary:** bug, off_by_one, null_pointer, memory_leak, race_condition, zombie_process, heisenbug, segfault, and a deadlock boss every fifth depth. Weapons are debugging tools (`grep` → `ebpf`), armour is safety nets (`linter` → `formal_proof`).
- **Permadeath:** when the daemon dies it lands in the graveyard with its exit code, and a new daemon is forked.
- **Deterministic:** the mulberry32 PRNG state is saved with the world, so every frame is a pure function of the previous one.
- **Rendered as text:** a 79-column frame inside a `diff` fence. GitHub's own diff highlighter colours the log (`+` kills/loot, `-` damage/death, `!` level-ups/gear, `#` info, `@@` depth changes).
- **Balance:** tuned by offline simulation. A daemon typically dies around depth 7 (p90 ≈ 20) after roughly 40 frames (~1.7 days).

Tunables: `DUNGEON_TURNS` (turns per frame, default 40) and `DUNGEON_SEED` (seed for a brand-new world). Delete `game/state.json` to start a new world.

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
DUNGEON_TURNS=400 npm run tick     # fast-forward ten frames' worth of turns
```
