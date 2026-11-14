# LOS SANTOS RISING — Blood & Concrete

![cover](assets/cover.png)

An open-world crime game that runs **in the browser**, inspired by *GTA: San Andreas*. Built with **three.js** and vanilla ES modules — **no build step, no downloads, no external assets**: every building, car, pedestrian, weapon, texture, sound and radio song is generated procedurally at runtime.

You are **Jay Mercer**, back in Los Santos because your sister has vanished. **24 story missions** across two chapters — turf wars, chases, a sniper hit, a harbour heist, an armoured-truck robbery, a bank job and a convoy finale — plus **24 optional side quests**, including **20 new parallel contracts** for Chapters I and II: repo work, street racing, firefighting, demolition derby, surveillance photography, hacking, bounty hunting, a spike-strip ambush, a bomb defusal and more. Taxi/vigilante duty and a living, open city fill the rest.

## Play

```bash
npm start            # = node server.js 8080
# open http://localhost:8080/
```

Any static server works — it's just `index.html` + `src/` + `assets/` + `lib/`. Chrome / Edge / Firefox with WebGL2; a mid-range GPU is enough (it lowers shadows and view distance on slow machines).

## Controls

| | |
|---|---|
| Move / look | `W A S D` / mouse |
| Sprint / jump / crouch | `Shift` / `Space` / `C` |
| Fire / aim | left mouse / right mouse |
| Weapon / reload | `Q` `E` wheel, `1`–`9` / `R` |
| Enter–exit–hijack vehicle | `F` |
| Interact (missions, dealers, save icon) | `E` |
| Drive | `W A S D`, `Space` handbrake, `H` horn, `C` look back |
| Radio | `R` / `T` tune, `X` off |
| Map / pause | `M` / `Esc` |
| Recruit homie / duty | `G` near Emerald Row / `N` in a taxi or police car |
| Cheats | type `cheatmode` while playing for the list |

## Screenshots

| | |
|---|---|
| ![title](assets/screenshots/title.png) | ![driving](assets/screenshots/driving_city.png) |
| ![coast road](assets/screenshots/driving_coast.png) | ![police chase](assets/screenshots/driving_chase.png) |
| ![bank heist](assets/screenshots/heist.png) | ![Pay 'n' Spray](assets/screenshots/garage.png) |

## Notes

- **Everything is procedural** — no asset files are downloaded, and there is no network access at runtime.
- The city is read from images in `assets/` (roads, districts, height, gang turf); `tools/make_map.py` authors the Los Santos-inspired layout.
- Save at the safehouse **save icon** (press `E`), and automatically after missions (`F5` quick-saves when free).
- Side quests: [`docs/SIDEQUESTS.md`](docs/SIDEQUESTS.md) lists all 24 optional jobs and their unlock chains.
- Dev: `node tools/bot.js --from m01 --to m24` auto-plays the whole story with cheats to catch script errors.
- Autonomous dev loop: `npm run agent:gates` for the deterministic gates, `npm run agent:once` for one
  implement → test → verify iteration, `npm run agent:loop` to improve the game unattended, and
  `npm run agent:swarm` for parallel worktree workers with serial verified integration —
  see [`docs/AGENT_LOOP.md`](docs/AGENT_LOOP.md). `npm run agent:dashboard` opens a live local
  overview at http://127.0.0.1:8787/.
- Architecture and conventions: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/SPEC.md`](docs/SPEC.md).

## Credits

An AI-built fan-style homage. *Grand Theft Auto* and *San Andreas* belong to Rockstar Games; this contains none of their assets, characters or story.
