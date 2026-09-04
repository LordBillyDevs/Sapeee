# MU Online Client Editor

A focused MU Online terrain and map editor built with TypeScript, Three.js, and Vite. The desktop build opens directly on world editing and exports encrypted files compatible with the game client.

> **Version** 1.1.0 | **License** ISC

## Features

### Core Viewers

- **Model Viewer**: Load and inspect `.bmd` 3D models with drag-and-drop support. Browse entire folders of models with auto-generated thumbnails. Automatic texture search in Electron.
- **Character Viewer**: Preview character models with customizable equipment (helm, armor, pants, gloves, boots, left/right hand weapons, wings), item effects (level +0 to +15, Excellent, Ancient), 15+ character classes across all tiers, animation control, and presets.
- **World/Terrain Editor**: The primary workspace for loading, navigating, and editing MU Online maps with an interactive camera, object transform gizmo, minimap navigation, bookmarks, and OBJ/MAP export.

### Data Browsers

- **Items Browser**: Parse and explore `items.bmd` files with equipment stats, search, and item kind filtering (Weapon, Armor, Potion, Jewel).
- **Skills Browser**: Parse and explore `skill.bmd` files with skill statistics, search, and type filtering (Attack, Buff, De-Buff, Friendly).
- **ATT Inspector**: Inspect terrain attribute data (`.att` files) with interactive map canvas, flag layer toggles, and per-tile tooltips.
- **OZJ/OZT Browser**: Browse `.ozj` and `.ozt` texture files with thumbnail grid, full-size preview, navigation, search, and format filtering.
- **GFx Browser**: Load and render `.ozg`, `.gfx`, `.swf` UI files on a zoomable/pannable stage canvas. View embedded bitmaps in a gallery, browse SWF tag tables, and load `.ozd` texture galleries with DDS decoding.
- **Sound Browser**: Browse and play `.ogg`, `.wav`, `.mp3` sound files from a folder with playback controls, volume slider, and filename search.

### 3D Model Features

- **Texture Support**: Apply various texture formats including `.jpg`, `.png`, `.tga`, `.ozj`, `.ozt` with automatic blend-mode detection.
- **Renderer Backend**: Choose between Auto (prefer WebGPU), WebGPU, or WebGL renderer per viewer. Automatic fallback when WebGPU is unavailable.
- **Animation Playback**: View all embedded animations with adjustable playback speed and enable/disable toggle.
- **External Animations**: Load bone animations from a different `.bmd` file.
- **Attachment System**: Attach a secondary `.bmd` model to any bone of the main model with bone selection via dropdown or slider.
- **Frame Lock**: Lock the animation on a specific frame with "Set Current" convenience button.
- **Viewport Helpers**: Toggle wireframe, skeleton, bounding box, axes, and vertex normals visibility.
- **Scene Controls**: Adjust model scale, scene brightness, and background color. Auto-rotate toggle.
- **Mesh Blending**: Fine-tune texture blending mode and alpha threshold per mesh when automatic material detection needs correction.
- **GIF Export**: Export model animations as `.gif` with configurable resolution, frame delay, and smoothness multiplier.
- **GLB Export**: Export models and animations to `.glb` format (standard or AI-baked with skinned mesh pre-bake).
- **Texture Export**: Export all applied textures to `.png` format.
- **Model Folder Browser**: Load a folder of `.bmd` files and browse them with auto-generated 3D thumbnail previews and lazy rendering.
- **Diagnostics Panel**: View real-time info about the loaded model - mesh vertices, bone count, animation clips, key count, current frame, and FPS.

### Character Viewer Features

- Full equipment slot system (helm, armor, pants, gloves, boots, left/right hand, wings).
- Item level (+0 to +15) with Excellent and Ancient modifier flags.
- Excellent glow intensity control.
- Character presets (save and restore class, gear, and render state).
- Per-viewer renderer backend, viewport helpers, and GIF export.

### World/Terrain Features

- Load entire `Data` folder and select world by index.
- Minimap with camera position tracking.
- Jump-to-coordinate navigation.
- Terrain object selection with focus, isolate, and "Open in Model Viewer" actions.
- Object transform gizmo (translate/rotate) with apply/reset.
- Object editor panel with position, scale, and per-type material overrides.
- ATT attribute overlay with TWFlags visualization.
- Bookmarks (save/restore camera positions).
- Export world geometry as OBJ.
- Edit base texture, overlay texture, and blend alpha per terrain tile.
- Import map texture files or texture packages, choose from a thumbnail palette, and paint a texture across tiles with an adjustable brush.
- Select objects manually from a world object list.
- Export edited MAP and OBJ files into a client-compatible `WorldN` folder.
- Terrain object overrides persisted to `terrain-object-overrides.json`.
- Wireframe, animations, sun light, and object draw-distance controls.

The model, character, ATT, item, skill, GFx, and sound implementations remain available internally for compatibility and focused actions, but are not direct navigation modules in the map editor shell.

### Additional Features

- **Presentation Mode**: Hide all UI for clean model viewing and screenshots.
- **Panel Resizing**: Drag to resize sidebar and log bar; reset layout button.
- **Crypto Engine**: Built-in decryptors for encrypted game assets (CAST5, IDEA, GOST, LEA256, MARS, RC5, RC6, TEA, ThreeWay, modulus).
- **Log Bar**: Real-time log output with per-viewer status indicators.

## Desktop App (Electron)

The desktop version provides additional capabilities not available in the browser:

- Native file dialogs for opening files and directories.
- Automatic texture search in nearby folders when loading a model.
- Direct file system access for loading world data and terrain objects.
- Terrain object overrides read/write to user data directory.
- Cross-platform builds: Windows (NSIS installer, x64), Linux (AppImage, x64), macOS (DMG).

For a standalone Windows `.exe` without installation, run
`npm run electron:build:portable`; the artifact is written to `release/`.

## Tech Stack

- **Language**: TypeScript (strict mode)
- **3D Engine**: Three.js (with WebGPU + WebGL renderer support)
- **Build**: Vite with code-splitting (Rolldown)
- **Desktop**: Electron with electron-builder
- **Test**: Jest with ts-jest
- **CI/CD**: GitHub Actions - auto-deploy to GitHub Pages, build Electron installers on push to main

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v22+ (v22.12.0 tested in CI)
- [npm](https://www.npmjs.com/)

### Installation

1. Clone the repository or download the source code.
2. Open a terminal in the project directory.
3. Install the required dependencies:

```bash
npm install
```

### Development

**Web (browser)**:

```bash
npm run dev
```

Opens at `http://localhost:5173` with hot-reloading.

**Electron (desktop)**:

```bash
npm run electron
```

Starts Vite dev server and launches the Electron shell once ready.

### Production Build

**Web**:

```bash
npm run build
```

Output goes to `dist/`. Set `VITE_BASE_PATH` for custom base paths (e.g. GitHub Pages).

**Electron desktop app**:

```bash
npm run electron:build
```

Generates installers in `release/`. Supports `--win` and `--linux` flags.

### Running Tests

```bash
npm test
```

Jest suite with ts-jest, running in Node environment. Tests cover loaders, parsers, terrain utilities, crypto ciphers, and UI components.

## How to Use

### Navigation

The application uses a tabbed interface with 9 workspaces:

| Tab | Purpose |
|---|---|
| **Model** | View `.bmd` 3D models with textures, animations, and attachments |
| **Character** | Preview characters with customizable class, equipment, and effects |
| **World** | Explore terrain with interactive camera and object editing |
| **ATT** | Analyze terrain attribute files with color-coded TWFlags map |
| **OZJ** | Browse `.ozj`/`.ozt` texture files with grid and preview |
| **Items** | Search and inspect item definitions from `items.bmd` |
| **Skills** | Search and inspect skill definitions from `skill.bmd` |
| **GFx** | Render `.ozg`/`.gfx`/`.swf` UI files and browse `.ozd` textures |
| **Sound** | Browse and play `.ogg`/`.wav`/`.mp3` sound files |

### Model Viewer Workflow

1. **Load a Model**: Drag and drop a `.bmd` file onto the drop zone, or click to open the file selector. In Electron, native file dialog is used automatically.
2. **Browse a Folder**: Drop or select a folder of `.bmd` files to browse models with thumbnail previews.
3. **Apply Textures**: Once the model is loaded, the viewer shows required textures. Drop the corresponding texture files (`.jpg`, `.tga`, `.ozj`, `.ozt`). In Electron, textures are searched automatically.
4. **Control Animations**: Use the animation buttons to play different clips, adjust speed, enable/disable, or lock a specific frame.
5. **Attach Models**: Drop an attachment `.bmd` and select a bone to attach it to.
6. **Adjust Viewport**: Toggle wireframe, skeleton, bounding box, axes, normals; change background color and brightness; switch renderer backend.
7. **Export**: Use export buttons for GLB, AI GLB (baked), textures (PNG), or GIF.

### Character Viewer Workflow

1. **Load Game Data**: Drop the game `Data` folder to populate class and equipment lists.
2. **Choose a Class**: Select a character class from the dropdown (15+ classes across all tiers).
3. **Equip Items**: Set helm, armor, pants, gloves, boots, weapons, and wings.
4. **Adjust Item Effects**: Set item level (+0 to +15), toggle Excellent/Ancient, adjust glow intensity.
5. **Save Presets**: Save and restore the current configuration.
6. **Export**: Record a GIF of the character.

### World/Terrain Workflow

1. **Load Game Data**: Drop the `Data` folder and select a world to load.
2. **Navigate**: Use the minimap or jump to coordinates. Save bookmarks for quick access.
3. **Inspect ATT**: Toggle ATT overlay to visualize terrain flags; use the ATT Inspector tab for detailed per-tile lookup.
4. **Select Objects**: Click objects in the scene; use the gizmo to move or rotate them. Right-click for the object editor panel.
5. **Edit Objects**: Adjust position, scale, and material overrides. In **Place a copy**, enter X/Y/Z map coordinates and use **Duplicate at coordinates** or **Add copy at coordinates** to create a physical BMD instance at that location. Settings persist to `terrain-object-overrides.json`.
6. **Export**: Export world geometry as OBJ.

### Data Browser Workflow

1. **Load Files**: Drag and drop `items.bmd`, `skill.bmd`, `.att`, `.ozj`/`.ozt`, `.ozg`/`.gfx`/`.swf`/`.ozd`, or sound folders into the respective browser tabs.
2. **Search**: Use the search bar to find specific entries by name, index, or ID.
3. **Filter**: Use type/kind/format filters to narrow down results.
4. **View Details**: Click any row to see detailed information in the detail panel.

### Bookmarks and Presets

- **Terrain Bookmarks**: Save camera positions in the World viewer for quick navigation.
- **Character Presets**: Save and manage character class, equipment, and render state configurations.

## Project Structure

```
src/
  main.ts                  # Model viewer app entry point
  character-test-scene.ts  # Character viewer scene
  terrain-scene.ts         # World/terrain viewer scene
  bmd-loader.ts            # BMD format parser
  ozj-loader.ts            # OZJ texture decoder
  app/                     # Explorer shell and state management
  att-inspector/           # ATT file inspector
  bmd-writer/              # BMD writer (placeholder)
  control-menu/            # Sidebar control menu system
  crypto/                  # Cipher implementations (CAST5, IDEA, GOST, etc.)
  explorer-state/          # Persistent state store
  gfx-browser/             # GFx/OZG/SWF/OZD browser
  helpers/                 # Three.js helper utilities
  item-bmd-browser/        # Items BMD data browser
  ozj-browser/             # OZJ/OZT texture browser
  rendering/               # WebGPU/WebGL renderer backend abstraction
  skill-bmd-browser/       # Skills BMD data browser
  sound-browser/           # Sound file browser and player
  terrain/                 # Terrain loaders, mesh, objects, culling, texturing
  utils/                   # File validation, texture matching, blend heuristics, etc.
  styles/                  # CSS stylesheets
electron/
  main.js                  # Electron main process
  preload.js               # Preload script for IPC bridge
tests/                     # Jest test suite
docs/                      # Documentation and plans
```

## CI/CD

GitHub Actions workflow (`.github/workflows/deploy.yml`) runs on pushes to `main`:

- **Web build**: Builds Vite app and deploys to GitHub Pages (under `/app/` path).
- **Linux build**: Creates an AppImage artifact.
- **Windows build**: Creates an NSIS installer artifact.
- **Release**: Uploads desktop builds to a GitHub Release with auto-generated tag.
