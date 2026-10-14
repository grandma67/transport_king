# Transport King 🚕

A puzzle game for the browser with endless levels. Unblock the parking lot, park the right vehicles, and send every passenger home.

## How to play

- A line of passengers waits at the stop. Each colour is a destination. You only see the front of the line.
- The lot is a maze of vehicles that block each other. Each vehicle can only drive forward, the way its arrow points.
- Tap a vehicle whose path is clear. It drives around the road into a free parking spot.
- The front passenger boards a parked vehicle of the same colour. When a vehicle is full it leaves and frees its spot.
- **Win:** every vehicle and passenger is cleared.
- **Lose:** every spot is taken and the front passenger matches none of the parked vehicles.
- **Stuck?** Tap 💡 and the game searches for a solution from the board as it is now (for up to 10 seconds). If it finds one, a hand slowly taps each vehicle in turn so you can watch and learn; tap **Stop** to take over again. If there is no way out, or the search runs out of time, it tells you.

## Levels

Levels are generated from their number (seeded), so level 42 is always the same level 42, and there is no last level. The seed rolls the lot size (up to 10×14), the number of parking spots (1–6), the number of colours (always more than the spots), the seats per vehicle, and how much of the line you can see. Each level builds several mazes and keeps the one with the longest chains of blocking vehicles. Then the solver plays it: if it cannot be won, the map is built again from the same seeded random stream until one can, so every level is beatable and still the same on every device.

- **Vehicles:** car (1×2), van (1×3), long bus (1×4), and a two-lane big bus (2×3) that needs both lanes clear to leave. Bigger vehicles carry more passengers.

- **Layouts:** rectangle, diamond, oval, plus, donut, hourglass, stairs, arch, aisles, islands, holes
- **Themes:** City Rush (cars and people), Space Port (rockets and aliens), Harbor Hop (boats and penguins), Pet Express (trucks and cats), Candy Land (jelly cars and blobs), School Run (buses and kids)

Every level is checked to be winnable: all vehicles can get out, seats match passengers, and the line is built from a real solution that fits in the level's parking spots.

## Run locally

It is a static site with no build step. Open `index.html`, or serve the folder:

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

## Sounds

All sound effects are synthesised live with the Web Audio API, so there are no audio files and they work offline. Each theme has its own set:

| Theme | Vehicle tapped | Driving | Passenger boards |
|---|---|---|---|
| City Rush | car horn beep-beep | engine rev | soft pop |
| Space Port | laser blip | rocket whoosh | sci-fi bloop |
| Harbor Hop | fog horn | splashing water | penguin squeak |
| Pet Express | truck honk | putt-putt engine | meow |
| Candy Land | boing | wobbly jelly | sparkly bell |
| School Run | two-tone bus horn | diesel rumble | school bell |

Boarding sounds climb a pentatonic scale as seats fill. A blocked tap thuds, a full vehicle chimes as it leaves, and winning and losing each have a jingle. 
Each theme also has its own soft background music loop. The 🎵 button in the top bar turns music on and off; 🔊 mutes everything. On iPhone, sound plays even with the silent switch on (use 🔊 to mute).

## Saved progress

The game remembers your level, the highest level unlocked, and the sound and music settings. They are saved in the browser's IndexedDB (database `transport-king`), with a backup copy in `localStorage` under `transport-king.save`. After you win a level the game asks the browser to keep this data permanently (`navigator.storage.persist()`).

## Install as an app

Open the game in Chrome and choose **Install** in the address bar, or **Install app** in the game menu. It works offline after the first visit.

The game is meant to share `user.github.io` with other games, so the manifest has its own `id` (`transport-king`), the service worker only controls this folder, its cache is named `transport-king-v<version>-<build>`, and saved progress only ever reads, writes or deletes the `transport-king` database and `transport-king.*` keys, never other games' data. To release a new version, bump `VERSION` in `sw.js`. The deploy also stamps the commit SHA as the build.

## Tests

No dependencies are needed, only Node 24+ (see `.nvmrc`) and, for the browser tests, Google Chrome (set `CHROME_PATH` if it is not found).

```sh
npm test            # everything
npm run test:unit   # generator, game rules, PWA config, storage, sound
npm run test:e2e    # headless Chrome plays the game from a /transport_king/ subfolder
LEVELS=1000 npm run test:unit   # check more levels
```

- **Unit:** determinism, every level winnable within its spots, seats equal passengers, seeded ranges, colours outnumber spots, vehicles fit and never overlap, maze depth, blocking rules for wide buses, manifest and icons, cache naming, cache cleanup that never touches other apps, saved-data validation and migration, sound effects, music, and audio unlocking.
- **End-to-end:** installability, offline play, layout proportions, blocked taps, parking, boarding, departing, the full-parking warning, losing, winning levels by real clicks, saved progress in IndexedDB across reloads, other games' data left alone, sound and music buttons, the top bar on a small phone, themes, and big-bus rendering.

## Deploy to GitHub Pages

1. Push this repo to GitHub on the `main` branch.
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. `.github/workflows/pages.yml` runs all tests on every push and pull request, and publishes to `https://<user>.github.io/<repo>/` after they pass on `main`.

## Project layout

```
index.html             page shell and HUD
css/style.css          styles
js/levels.js           seeded level generator (pure logic, also used by the tests)
js/game.js             rendering, animation, input, and game rules
sw.js                  service worker (offline cache)
manifest.webmanifest   app manifest
icons/                 app icons
tests/                 unit and end-to-end tests
```
