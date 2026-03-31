# OBAMAFIER

Transform any image into Barack Obama using optimal pixel transport. Every pixel from your source image flies to a new position, reconstructing the Obama portrait — no colors are created or destroyed.

![Electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white)
![WebGL 2](https://img.shields.io/badge/WebGL-2.0-990000?logo=webgl&logoColor=white)

## How It Works

This is an **optimal transport** problem: given N source pixels and N target pixels, find the 1-to-1 mapping that minimizes total color distance.

### Algorithm Pipeline

1. **Preprocessing** — Both images are loaded, center-cropped to square, resized to matching dimensions, and converted to CIELAB color space for perceptually accurate distance calculations.

2. **Hilbert Curve Sort-Match** — Each pixel's LAB color is mapped to a position on a 3D Hilbert space-filling curve, which preserves color locality. Source and target pixels are sorted by their Hilbert index, then matched by rank. This gives an O(n log n) bijective assignment where similar colors map to similar target positions.

3. **Swap Refinement** — Random pairs of assignments are tested: if swapping two mappings reduces total color distance, the swap is kept. Millions of iterations polish the result, reducing error by 10-30% over Hilbert alone. Runs in a Web Worker to keep the UI responsive.

4. **GPU Animation** — All pixels are rendered as WebGL 2 GL_POINTS. A vertex shader interpolates each pixel along a quadratic Bezier curve from source to target position, with cubic easing and staggered launch times. 262,144 particles at 60fps.

### The Result

The final frame is Obama's official portrait reconstructed entirely from your source image's pixel colors. A photo of a cat produces an orange-tinted Obama. A blue sky produces a cool-toned Obama. The color palette is always 100% from the source.

## Features

- **Any image format** — JPG, PNG, WebP, AVIF, HEIF, GIF, BMP, TIFF, SVG, ICO
- **Configurable resolution** — 128 to 1024, or use original size (capped at 2048)
- **Quality presets** — Draft (500K swaps) to Ultra (15M swaps)
- **Adjustable animation** — Duration (1-15s), curvature (straight lines to wild arcs)
- **Drag and drop** — Drop any image onto the window
- **Save frames** — Export any frame as PNG
- **Responsive canvas** — Image fits the window at any size

## Getting Started

### Prerequisites

- Node.js 20+
- npm

### Install & Run

```bash
git clone https://github.com/Phennova/Obamafier.git
cd Obamafier
npm install
npm run dev
```

### Usage

1. Launch the app (`npm run dev`)
2. Drop an image onto the window or click **Load Image**
3. Wait for the assignment computation (progress bar shows %)
4. Click **OBAMAFI** to watch the pixels fly
5. Use **Save Frame** to export the result

### Controls

| Control | Description |
|---------|-------------|
| **Resolution** | Pixel grid size (higher = more detail, slower computation) |
| **Quality** | Number of swap refinement iterations |
| **Duration** | Animation length in seconds |
| **Curve** | How much pixel paths arc sideways (0 = straight, 1 = wild) |
| **OBAMAFI** | Start/replay the animation |
| **Reset** | Return to source image positions |
| **Clear** | Remove loaded image, start over |
| **Save Frame** | Export current frame as PNG |

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| App Shell | Electron 33 | Desktop app with native file dialogs |
| Renderer | WebGL 2 | GPU-accelerated particle rendering at 60fps |
| Compute | Web Workers | Offload assignment algorithm from main thread |
| Image I/O | Sharp | Fast image loading, resizing, color space handling |
| Bundler | Vite + vite-plugin-electron | Fast dev server with HMR |
| Language | TypeScript | Type safety across all processes |

## Architecture

```
Electron Main Process
  Sharp: load, resize, extract raw pixel buffers
  IPC bridge to renderer
         |
         v
Electron Renderer Process
  +-------------+    +--------------+    +-------------+
  |  UI Layer   |    | Web Worker   |    |  WebGL 2    |
  |             |    |              |    |  Renderer   |
  | Controls,   |<-->| Hilbert sort |<-->| Particle    |
  | Progress,   |    | Swap refine  |    | system,     |
  | Settings    |    | LAB convert  |    | Shaders,    |
  |             |    |              |    | Animation   |
  +-------------+    +--------------+    +-------------+
```

## Performance

| Resolution | Pixels | Assignment Time | Animation FPS |
|-----------|--------|----------------|---------------|
| 256x256 | 65,536 | ~1-2s | 60 fps |
| 512x512 | 262,144 | ~3-8s | 60 fps |
| 1024x1024 | 1,048,576 | ~15-30s | 30-60 fps |

## Scripts

```bash
npm run dev      # Vite dev server + Electron with hot reload
npm run start    # Build then launch
npm run build    # Production build
npm run pack     # Build + package with electron-builder
```

## License

MIT
