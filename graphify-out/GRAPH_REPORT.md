# Graph Report - transport_king  (2026-10-13)

## Corpus Check
- Corpus is ~15,972 words - fits in a single context window. You may not need a graph.

## Summary
- 172 nodes · 302 edges · 10 communities
- Extraction: 91% EXTRACTED · 9% INFERRED · 0% AMBIGUOUS · INFERRED: 26 edges (avg confidence: 0.85)
- Token cost: 112,138 input · 0 output

## Community Hubs (Navigation)
- Game Engine and Rendering
- Unit Test Suites
- Sound Synthesis
- Page Shell and Deployment
- Level Generator
- E2E Browser Tests
- Package Config
- Game Design Concepts
- PWA Icon Set
- App Icon Artwork

## God Nodes (most connected - your core abstractions)
1. `generateLevel()` - 11 edges
2. `index.html (page shell and HUD)` - 11 edges
3. `tone()` - 10 edges
4. `depart()` - 8 edges
5. `drive()` - 7 edges
6. `step()` - 7 edges
7. `analyze()` - 7 edges
8. `T()` - 6 edges
9. `layout()` - 6 edges
10. `positionQueue()` - 6 edges

## Surprising Connections (you probably didn't know these)
- `test job` --implements--> `Test suite (unit + headless Chrome e2e, no dependencies)`  [INFERRED]
  .github/workflows/pages.yml → README.md
- `Stamp service worker cache with the build (sed BUILD=sha)` --implements--> `Cache versioning (VERSION bump + deploy-stamped BUILD SHA)`  [INFERRED]
  .github/workflows/pages.yml → README.md
- `Test and deploy workflow (pages.yml)` --implements--> `Deploy to GitHub Pages`  [EXTRACTED]
  .github/workflows/pages.yml → README.md
- `index.html (page shell and HUD)` --implements--> `PWA install and offline support`  [INFERRED]
  index.html → README.md
- `index.html (page shell and HUD)` --implements--> `Static site with no build step`  [INFERRED]
  index.html → README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **PWA offline install with shared-origin isolation** — sw, manifest, readme_pwa_install, readme_shared_origin_isolation, readme_cache_versioning, _github_workflows_pages_stamp_service_worker_build [INFERRED 0.85]
- **CI test-then-deploy pipeline** — _github_workflows_pages_test, _github_workflows_pages_deploy, tests_levels_test, tests_pwa_test, tests_e2e_test [EXTRACTED 1.00]
- **Page shell loads levels, sound, game scripts** — index, js_levels, js_sound, js_game [EXTRACTED 1.00]
- **Transport King PWA / home-screen icon set** — icons_apple_touch_icon_image, icons_icon_192_image, icons_icon_512_image, icons_icon_maskable_512_image [INFERRED 0.85]

## Communities (10 total, 0 thin omitted)

### Community 0 - "Game Engine and Rendering"
Cohesion: 0.13
Nodes (36): applyTheme(), board(), buildStage(), bump(), carCenter(), checkLose(), checkWin(), computeGeo() (+28 more)

### Community 1 - "Unit Test Suites"
Cohesion: 0.08
Nodes (21): assert, levels, test, TK, assert, fs, loadSW(), manifest (+13 more)

### Community 2 - "Sound Synthesis"
Cohesion: 0.19
Nodes (17): board(), bump(), drive(), ensure(), envelope(), full(), lose(), noise() (+9 more)

### Community 3 - "Page Shell and Deployment"
Cohesion: 0.14
Nodes (15): Test and deploy workflow (pages.yml), deploy job, Stamp service worker cache with the build (sed BUILD=sha), test job, css/style.css, index.html (page shell and HUD), HUD header (menu, level, theme, stats, sound, restart), #toast and #overlay elements (+7 more)

### Community 4 - "Level Generator"
Cohesion: 0.28
Nodes (16): analyze(), buildOcc(), buildQueue(), carCells(), fillCars(), firstBlocker(), generateLevel(), harden() (+8 more)

### Community 5 - "E2E Browser Tests"
Cohesion: 0.17
Nodes (11): chromePath, js(), MIME, open(), pageErrors, pending, root, send() (+3 more)

### Community 6 - "Package Config"
Cohesion: 0.17
Nodes (11): description, engines, node, name, private, scripts, start, test (+3 more)

### Community 7 - "Game Design Concepts"
Cohesion: 0.22
Nodes (5): Transport King README, Lot layouts (rectangle, diamond, donut, ...), Themes (City Rush, Space Port, Harbor Hop, Pet Express, Candy Land, School Run), Transport King (browser puzzle game), Vehicle types (car, van, long bus, big bus 2x3)

### Community 8 - "PWA Icon Set"
Cohesion: 0.40
Nodes (5): Apple Touch Icon (Transport King app icon), App Icon 192px, App Icon 512px (crowned yellow bus over red/green buttons on blue rounded square), Transport King Brand Mark (crowned bus + red/green choice buttons), Maskable App Icon 512px (safe-zone padded variant)

### Community 9 - "App Icon Artwork"
Cohesion: 0.67
Nodes (4): Transport King App Icon, Blue Gradient Rounded Background, Crowned Yellow Bus Motif, Red/Green Control Buttons Base

## Knowledge Gaps
- **9 isolated node(s):** `Transport King README`, `Vehicle types (car, van, long bus, big bus 2x3)`, `Lot layouts (rectangle, diamond, donut, ...)`, `Test suite (unit + headless Chrome e2e, no dependencies)`, `Deploy to GitHub Pages` (+4 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 53 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `index.html (page shell and HUD)` connect `Page Shell and Deployment` to `Game Engine and Rendering`, `Sound Synthesis`, `Level Generator`, `E2E Browser Tests`?**
  _High betweenness centrality (0.474) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `index.html (page shell and HUD)` (e.g. with `Static site with no build step` and `PWA install and offline support`) actually correct?**
  _`index.html (page shell and HUD)` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Transport King README`, `Vehicle types (car, van, long bus, big bus 2x3)`, `Lot layouts (rectangle, diamond, donut, ...)` to the rest of the system?**
  _9 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Game Engine and Rendering` be split into smaller, more focused modules?**
  _Cohesion score 0.1337126600284495 - nodes in this community are weakly interconnected._
- **Why does `test job` connect `Page Shell and Deployment` to `Unit Test Suites`, `E2E Browser Tests`?**
  _High betweenness centrality (0.066) - this node is a cross-community bridge._
- **Should `Unit Test Suites` be split into smaller, more focused modules?**
  _Cohesion score 0.07956989247311828 - nodes in this community are weakly interconnected._
- **Why does `Seeded endless level generation` connect `Game Design Concepts` to `Level Generator`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._