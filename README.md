# Transport King 🚕

A puzzle game for the browser with endless levels. Unblock the parking lot, park the right vehicles, and send every passenger home.

## How to play

- A line of passengers waits at the stop. Each colour is a destination. You only see the front of the line.
- The lot is a maze of vehicles that block each other. Each vehicle can only drive forward, the way its arrow points.
- Tap a vehicle whose path is clear. It drives around the road into a free parking spot.
- The front passenger boards a parked vehicle of the same colour. When a vehicle is full it leaves and frees its spot.
- **Win:** every vehicle and passenger is cleared.
- **Lose:** every spot is taken and the front passenger matches none of the parked vehicles.

## Levels

Levels are generated from their number (seeded), so level 42 is always the same level 42, and there is no last level. Difficulty grows with the lot size, the number of colours, how many vehicles' passengers are mixed in the line, and how little of the line you can see.

- **Layouts:** rectangle, diamond, oval, plus, donut, hourglass, stairs, arch, aisles, islands, holes
- **Themes:** City Rush (cars and people), Space Port (rockets and aliens), Harbor Hop (boats and penguins), Pet Express (trucks and cats), Candy Land (jelly cars and blobs), School Run (buses and kids)

Every level is checked to be winnable: all vehicles can get out, seats match passengers, and the line is built from a real solution that never needs more than 4 of the 5 spots.

## Run locally

It is a static site with no build step. Open `index.html`, or serve the folder:

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

Run the tests, which play 500 levels with the game rules:

```sh
node tests/levels.test.js 500
```

## Deploy to GitHub Pages

1. Push this repo to GitHub on the `main` branch.
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. The workflow in `.github/workflows/pages.yml` runs the tests and publishes the site on every push to `main`.

## Project layout

```
index.html         page shell and HUD
css/style.css      styles
js/levels.js       seeded level generator (pure logic, also used by the tests)
js/game.js         rendering, animation, input, and game rules
tests/             solvability tests
```
