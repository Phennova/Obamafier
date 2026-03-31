# OBAMAFIER

Transform any image into Barack Obama using optimal pixel transport. Every pixel from your source image flies to a new position, reconstructing the Obama portrait — no colors are created or destroyed.

Now with **Obamacryption** — visual steganographic encryption that hides your image inside Obama's face.

![Electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white)
![WebGL 2](https://img.shields.io/badge/WebGL-2.0-990000?logo=webgl&logoColor=white)

## Three Modes

### Obamafi
The original mode. Load any image, click OBAMAFI, and watch every pixel fly to form Obama's face. The result is Obama reconstructed entirely from your image's pixel colors — a cat photo produces an orange-tinted Obama, a blue sky produces a cool-toned one.

### Obamacrypt
Visual encryption powered by optimal pixel transport.

1. Load any image
2. Click **OBAMACRYPT** — the algorithm color-matches your pixels to Obama's portrait
3. Pixels animate flying into Obama's face
4. Download the result — it looks like a normal Obama photo
5. The decryption key is **hidden inside the PNG metadata**, invisible to image viewers, browsers, and file explorers. Only Obamafier can find it.

### Deobamacrypt
Reverse the encryption.

1. Load an obamacrypted PNG
2. Obamafier **automatically detects and reads the hidden key** from the image metadata
3. Click **DEOBAMACRYPT** — pixels fly back to their original positions
4. Download the recovered original image

One file. No separate keys. The secret is baked into the image itself.

## How It Works

### Optimal Transport (Obamafi & Obamacrypt)

This is an **optimal transport** problem: given N source pixels and N target pixels, find the 1-to-1 mapping that minimizes total color distance.

1. **Preprocessing** — Both images are loaded, center-cropped to square, resized to matching dimensions, and converted to CIELAB color space for perceptually accurate distance calculations.

2. **Hilbert Curve Sort-Match** — Each pixel's LAB color is mapped to a position on a 3D Hilbert space-filling curve, which preserves color locality. Source and target pixels are sorted by their Hilbert index, then matched by rank. This gives an O(n log n) bijective assignment where similar colors map to similar target positions.

3. **Swap Refinement** — Random pairs of assignments are tested: if swapping two mappings reduces total color distance, the swap is kept. Millions of iterations polish the result, reducing error by 10-30% over Hilbert alone. Runs in a Web Worker to keep the UI responsive.

4. **GPU Animation** — All pixels are rendered as WebGL 2 GL_POINTS. A vertex shader interpolates each pixel along a quadratic Bezier curve from source to target position, with cubic easing and staggered launch times. 262,144 particles at 60fps.

### Steganographic Key Storage (Obamacrypt)

The permutation (which pixel went where) is the decryption key. It's encoded as a delta-compressed, varint-packed, zlib-compressed binary blob and injected into the PNG as a custom `zTXt` text chunk with a proprietary keyword.

- Image viewers ignore unknown `zTXt` chunks — the image looks completely normal
- File size increase is minimal (~200-500KB depending on resolution)
- The key is only readable by software that knows the exact chunk keyword to search for
- Standard image operations (viewing, sharing, uploading) preserve PNG metadata

## Features

- **Any image format** — JPG, PNG, WebP, AVIF, HEIF, GIF, BMP, TIFF, SVG, ICO
- **Configurable resolution** — 128 to 1024, or use original size (capped at 2048)
- **Quality presets** — Draft (500K swaps) to Ultra (15M swaps)
- **Adjustable animation** — Duration (1-15s), curvature (straight lines to wild arcs)
- **Drag and drop** — Drop any image onto the window
- **Save frames** — Export any frame as PNG
- **Responsive canvas** — Image fits the window at any size
- **Hidden key metadata** — Decryption key embedded invisibly in the encrypted PNG

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

### Controls

| Control | Description |
|---------|-------------|
| **Resolution** | Pixel grid size (higher = more detail, slower computation) |
| **Quality** | Number of swap refinement iterations (Obamafi mode) |
| **Duration** | Animation length in seconds |
| **Curve** | How much pixel paths arc sideways (0 = straight, 1 = wild) |
| **OBAMAFI / OBAMACRYPT / DEOBAMACRYPT** | Start the transformation |
| **Reset** | Return to source image positions |
| **Clear** | Remove loaded image, start over |
| **Save Frame / Download PNG** | Export the result |

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| App Shell | Electron 33 | Desktop app with native file dialogs |
| Renderer | WebGL 2 | GPU-accelerated particle rendering at 60fps |
| Compute | Web Workers | Offload assignment algorithm from main thread |
| Image I/O | Sharp | Image loading, resizing, PNG metadata injection |
| Bundler | Vite + vite-plugin-electron | Fast dev server with HMR |
| Language | TypeScript | Type safety across all processes |

## Architecture

```
Electron Main Process
  Sharp: load, resize, extract pixels, inject/read PNG metadata
  IPC bridge to renderer
         |
         v
Electron Renderer Process
  +-------------+    +--------------+    +-------------+
  |  UI Layer   |    | Web Workers  |    |  WebGL 2    |
  |             |    |              |    |  Renderer   |
  | Mode tabs,  |<-->| Hilbert sort |<-->| Particle    |
  | Controls,   |    | Swap refine  |    | system,     |
  | Key display |    | LAB convert  |    | Shaders,    |
  | Progress    |    | Permutation  |    | Animation   |
  |             |    | codec        |    | loop        |
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

## Security Note

Obamacryption is a visual steganography tool for fun and education. The hidden key is obscured (not visible to casual inspection) but not cryptographically encrypted — a determined analyst who knows the PNG format could extract the `zTXt` chunk. For real-world secret communication, use established cryptographic tools.

## License

MIT
