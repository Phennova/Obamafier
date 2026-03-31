# OBAMAFIER — Full Engineering Plan

## 1. Concept

**Input:** Any image (the "source")
**Target:** The Obama reference image (bundled with the app)
**Output:** A real-time animation where every pixel from the source image smoothly flies to a new position, forming the closest possible reconstruction of the Obama image — using ONLY the original pixels. No colors are created or destroyed.

---

## 2. The Core Problem

This is **optimal transport** (a.k.a. the assignment problem): given N source pixels and N target pixels, find the 1-to-1 mapping that minimizes total color distance.

### Why it's hard:
- A 512×512 image = **262,144 pixels**
- The Hungarian algorithm (exact optimal assignment) is O(n³) → ~10¹⁶ operations. Impossible.
- Even 256×256 (~65K pixels) is too large for exact methods.
- We need **approximate optimal transport** that runs in seconds, not centuries.

---

## 3. Algorithm Pipeline

### Phase 1: Image Preprocessing

```
Source Image → Resize → Extract Pixels → LAB Color Convert
Target Image → Resize → Extract Pixels → LAB Color Convert
```

1. **Load** source and target images.
2. **Resize** both to the same resolution (user-configurable: 256², 512², or 1024²).
   - If aspect ratios differ, center-crop the larger image to match.
   - Use Lanczos resampling for quality.
3. **Extract** all pixels as flat arrays: `[(r,g,b), (r,g,b), ...]` with their (x,y) positions.
4. **Convert** to CIELAB color space for perceptually accurate distance calculations.

### Phase 2: Pixel Assignment (The Hard Part)

We use a **multi-strategy approach**, from fast-approximate to refined:

#### Strategy A — Hilbert Curve Sort Matching (Primary)
This is the workhorse. It's O(n log n) and produces surprisingly good results.

1. Map each pixel's (L, a, b) color to a position on a **3D Hilbert space-filling curve**.
   - The Hilbert curve preserves locality: nearby colors get nearby curve indices.
2. Sort all source pixels by their Hilbert curve index.
3. Sort all target pixels by their Hilbert curve index.
4. **Match by rank**: sorted source pixel #0 → sorted target pixel #0, etc.
5. This gives a global assignment where similar colors go to similar-colored target positions.

**Why this works:** The Hilbert curve respects color proximity. If a source pixel is bright red, it'll be matched to a target position that *needs* something close to bright red. The sort guarantees a bijection (1-to-1 mapping) automatically.

**Complexity:** O(n log n) — runs in <1 second for 512×512.

#### Strategy B — Local Swap Refinement (Polish)
After the Hilbert assignment, improve it with greedy local swaps:

```
for iterations in range(K):
    pick two random assigned pairs (s1→t1, s2→t2)
    current_cost = dist(s1, t1) + dist(s2, t2)
    swap_cost    = dist(s1, t2) + dist(s2, t1)
    if swap_cost < current_cost:
        swap the assignments
```

- Run ~5–10 million random swap attempts (configurable).
- Can be parallelized across CPU cores with Web Workers.
- Reduces total color error by 10–30% over Hilbert alone.
- Each iteration is O(1), total is O(K).

#### Strategy C — Bucket-Refined Assignment (Optional Quality Tier)
For maximum accuracy at the cost of more compute:

1. Quantize the color space into ~256–1024 buckets (k-means or uniform grid in LAB).
2. Assign each source and target pixel to its nearest bucket.
3. Within each bucket, solve a smaller assignment problem:
   - If bucket has ≤1000 pixels, use the **Jonker-Volgenant algorithm** (fast exact assignment).
   - If bucket has >1000, use Hilbert sort within the bucket.
4. Handle bucket size mismatches by overflowing excess pixels to the nearest neighboring bucket.

**Complexity:** O(n log n) for bucketing + O(k³) per bucket where k is small → fast in practice.

### Phase 3: Path Generation

Once we know each pixel's start (x₀, y₀) and end (x₁, y₁):

1. **Direct path** with easing: `lerp(start, end, ease(t))`
   - Use cubic-bezier or exponential ease-in-out.
2. **Staggered launch**: Not all pixels start moving at t=0.
   - Assign a random delay (or spatial delay: center launches first, edges last).
   - This creates a "wave" or "explosion" feel.
3. **Curved paths** (optional, for wow-factor):
   - Add a random control point offset perpendicular to the direct path.
   - Use quadratic Bezier: `B(t) = (1-t)²P₀ + 2(1-t)tP_ctrl + t²P₁`
   - Pixels arc and swirl rather than moving in straight lines.
4. **Turbulence** (optional):
   - Add simplex noise displacement during flight.
   - Pixels wobble slightly as they fly, then settle precisely at the end.

---

## 4. Architecture

### Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **App Shell** | Electron | Desktop app with native file dialogs, bundled target image |
| **Renderer** | WebGL 2 (via raw GL or Three.js) | GPU-accelerated particle rendering — millions of points at 60fps |
| **Compute** | Web Workers + WASM | Offload assignment algorithm from main thread |
| **Image I/O** | Sharp (Node.js) | Fast image loading, resizing, color space conversion |
| **Language** | TypeScript | Type safety across main/renderer/worker processes |

### Process Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Electron Main Process                 │
│                                                         │
│  - File dialogs (open source image)                     │
│  - Sharp: load, resize, extract raw pixel buffers       │
│  - IPC bridge to renderer                               │
└────────────────────────┬────────────────────────────────┘
                         │ IPC (ArrayBuffers)
                         ▼
┌─────────────────────────────────────────────────────────┐
│                  Electron Renderer Process               │
│                                                         │
│  ┌─────────────┐    ┌──────────────┐   ┌─────────────┐ │
│  │  UI Layer    │    │ Web Worker   │   │  WebGL      │ │
│  │             │    │  Pool        │   │  Renderer   │ │
│  │ - Controls  │    │              │   │             │ │
│  │ - Progress  │◄──►│ - Hilbert    │──►│ - Particle  │ │
│  │ - Settings  │    │   sort       │   │   system    │ │
│  │             │    │ - Swap       │   │ - Shaders   │ │
│  │             │    │   refinement │   │ - Animation │ │
│  │             │    │ - Bucketing  │   │   loop      │ │
│  └─────────────┘    └──────────────┘   └─────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### Data Flow

```
1. User drops/selects source image
       │
       ▼
2. Main process: Sharp loads + resizes both images to matching dimensions
       │
       ▼
3. Main process sends two raw RGBA buffers to renderer via IPC
       │
       ▼
4. Renderer spawns Web Worker for assignment computation
       │
       ▼
5. Worker: Hilbert sort → match → swap refinement → returns assignment map
       │  (posts progress updates back to renderer for UI)
       ▼
6. Renderer builds WebGL buffers:
       - Vertex buffer: [x0, y0, x1, y1, r, g, b, delay] per pixel
       │
       ▼
7. Animation loop starts:
       - Vertex shader interpolates position based on uniform `u_time`
       - Fragment shader outputs pixel color (constant per particle)
       - Runs at 60fps via requestAnimationFrame
       │
       ▼
8. Animation completes → final frame is the reconstructed Obama image
```

---

## 5. WebGL Particle System Design

### Vertex Attributes (per pixel)

```glsl
attribute vec2 a_startPos;  // source image position (normalized 0-1)
attribute vec2 a_endPos;    // target image position (normalized 0-1)
attribute vec3 a_color;     // RGB color of this pixel (never changes)
attribute float a_delay;    // staggered start time (0.0 - 0.3)
attribute vec2 a_curvature; // bezier control point offset
```

### Vertex Shader

```glsl
uniform float u_time;        // animation progress (0.0 → 1.0)
uniform float u_pointSize;   // pixel size based on resolution
uniform vec2 u_resolution;   // canvas resolution

attribute vec2 a_startPos;
attribute vec2 a_endPos;
attribute vec3 a_color;
attribute float a_delay;
attribute vec2 a_curvature;

varying vec3 v_color;

// Cubic ease-in-out
float ease(float t) {
    return t < 0.5
        ? 4.0 * t * t * t
        : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0;
}

void main() {
    // Staggered timing
    float localTime = clamp((u_time - a_delay) / (1.0 - a_delay), 0.0, 1.0);
    float t = ease(localTime);

    // Quadratic Bezier interpolation
    vec2 control = mix(a_startPos, a_endPos, 0.5) + a_curvature;
    vec2 pos = (1.0 - t) * (1.0 - t) * a_startPos
             + 2.0 * (1.0 - t) * t * control
             + t * t * a_endPos;

    // Map to clip space
    vec2 clipPos = pos * 2.0 - 1.0;
    clipPos.y *= -1.0; // flip Y for image coordinates

    gl_Position = vec4(clipPos, 0.0, 1.0);
    gl_PointSize = u_pointSize;
    v_color = a_color;
}
```

### Fragment Shader

```glsl
precision mediump float;
varying vec3 v_color;

void main() {
    gl_FragColor = vec4(v_color, 1.0);
}
```

### Performance Budget

| Resolution | Pixels | Vertex Data | Target FPS |
|-----------|--------|-------------|------------|
| 256×256 | 65,536 | ~2 MB | 60 fps (easy) |
| 512×512 | 262,144 | ~8 MB | 60 fps (comfortable) |
| 1024×1024 | 1,048,576 | ~32 MB | 30-60 fps (GPU dependent) |

WebGL can handle millions of GL_POINTS trivially on any modern GPU. The bottleneck is the assignment algorithm, not rendering.

---

## 6. Hilbert Curve Implementation Details

### 3D Hilbert Curve for Color Space

We need to map (L, a, b) → single integer index while preserving spatial locality.

1. **Normalize** LAB values to integers in [0, 255]:
   - L: 0–100 → 0–255
   - a: -128–127 → 0–255
   - b: -128–127 → 0–255

2. **Compute 3D Hilbert index** at order 8 (256³ = 16.7M possible positions).
   - Use the Butz/Lawder algorithm for 3D Hilbert curve encoding.
   - This maps (x, y, z) → integer index on the curve.

3. **Sort** source pixels by Hilbert index. Sort target pixels by Hilbert index.

4. **Zip-match** by sorted rank.

### Pseudocode

```typescript
function assignPixels(source: Pixel[], target: Pixel[]): Map<number, number> {
    // Convert to LAB
    const sourceLAB = source.map(p => rgbToLab(p.r, p.g, p.b));
    const targetLAB = target.map(p => rgbToLab(p.r, p.g, p.b));

    // Compute Hilbert indices
    const sourceIndices = sourceLAB.map((lab, i) => ({
        hilbert: hilbert3D(
            Math.round(lab.L * 2.55),
            Math.round(lab.a + 128),
            Math.round(lab.b + 128)
        ),
        originalIndex: i
    }));

    const targetIndices = targetLAB.map((lab, i) => ({
        hilbert: hilbert3D(
            Math.round(lab.L * 2.55),
            Math.round(lab.a + 128),
            Math.round(lab.b + 128)
        ),
        originalIndex: i
    }));

    // Sort both by Hilbert index
    sourceIndices.sort((a, b) => a.hilbert - b.hilbert);
    targetIndices.sort((a, b) => a.hilbert - b.hilbert);

    // Match by rank
    const assignment = new Map(); // source pixel index → target pixel index
    for (let i = 0; i < sourceIndices.length; i++) {
        assignment.set(sourceIndices[i].originalIndex, targetIndices[i].originalIndex);
    }

    return assignment;
}
```

---

## 7. Swap Refinement Details

```typescript
function refineAssignment(
    assignment: number[],      // assignment[sourceIdx] = targetIdx
    sourceColors: Float32Array, // LAB colors, packed [L,a,b,L,a,b,...]
    targetColors: Float32Array,
    iterations: number = 5_000_000
): void {
    const n = assignment.length;

    for (let i = 0; i < iterations; i++) {
        // Pick two random source pixels
        const s1 = Math.floor(Math.random() * n);
        const s2 = Math.floor(Math.random() * n);
        if (s1 === s2) continue;

        const t1 = assignment[s1];
        const t2 = assignment[s2];

        // Current cost (squared Delta-E)
        const currentCost =
            labDistSq(sourceColors, s1, targetColors, t1) +
            labDistSq(sourceColors, s2, targetColors, t2);

        // Swapped cost
        const swapCost =
            labDistSq(sourceColors, s1, targetColors, t2) +
            labDistSq(sourceColors, s2, targetColors, t1);

        if (swapCost < currentCost) {
            assignment[s1] = t2;
            assignment[s2] = t1;
        }
    }
}

function labDistSq(
    colorsA: Float32Array, idxA: number,
    colorsB: Float32Array, idxB: number
): number {
    const oA = idxA * 3, oB = idxB * 3;
    const dL = colorsA[oA] - colorsB[oB];
    const da = colorsA[oA+1] - colorsB[oB+1];
    const db = colorsA[oA+2] - colorsB[oB+2];
    return dL*dL + da*da + db*db;
}
```

### Parallelization with Web Workers

- Spawn N workers (navigator.hardwareConcurrency).
- Each worker gets a copy of the assignment array and color data.
- Each worker runs M/N swap iterations on random pairs.
- After each batch, merge improvements back to main assignment.
- Use SharedArrayBuffer + Atomics for lock-free concurrent swaps (advanced).

---

## 8. UI Design

### Main Window Layout

```
┌──────────────────────────────────────────────────────┐
│  OBAMAFIER                              [_] [□] [X]  │
├──────────────────────────────────────────────────────┤
│                                                      │
│              ┌────────────────────────┐               │
│              │                        │               │
│              │    WebGL Canvas         │               │
│              │    (animation plays    │               │
│              │     here)              │               │
│              │                        │               │
│              └────────────────────────┘               │
│                                                      │
│  ┌──────────────────────────────────────────────┐    │
│  │  ████████████████████░░░░░░░░  67% Refining  │    │
│  └──────────────────────────────────────────────┘    │
│                                                      │
│  [📁 Load Image]  Resolution: [256 ▼]  [▶ OBAMAFI]  │
│                                                      │
│  Animation: ──●────── 3.0s   Easing: [Cubic ▼]      │
│  Curvature: ──●────── 0.4    Turbulence: [Low ▼]    │
│                                                      │
│  Quality: [★★★☆ High]  Swap iterations: [5M ▼]      │
│                                                      │
│  [💾 Export GIF]  [📹 Export MP4]  [📸 Save Frame]   │
└──────────────────────────────────────────────────────┘
```

### User Flow

1. App opens showing the Obama target as a reference thumbnail.
2. User clicks "Load Image" or drags an image onto the window.
3. Status: "Preprocessing..." (resize, color extraction) — ~instant.
4. Status: "Computing optimal assignment..." (Hilbert sort + swaps) — 2-10 seconds with progress bar.
5. Status: "Ready!" — the canvas shows the source image as static pixels.
6. User clicks "OBAMAFI" → animation plays.
7. Pixels fly from source positions to target positions over configurable duration.
8. Final frame holds: the Obama image reconstructed from the source's pixel palette.

---

## 9. Export System

### GIF Export
- Use `gif-encoder-2` or `gifenc` (WASM-based).
- Capture WebGL canvas at N fps during animation.
- Downscale to reasonable GIF dimensions (480px wide).

### MP4 Export
- Use `ffmpeg.wasm` to encode captured frames.
- Much better quality/size ratio than GIF.
- H.264 encoding, configurable quality.

### Screenshot
- `canvas.toDataURL('image/png')` for any single frame.
- Especially useful for the final "reconstructed" frame.

---

## 10. File Structure

```
obamafier/
├── package.json
├── tsconfig.json
├── electron-builder.yml
├── assets/
│   └── obama.png                  # Bundled target image
├── src/
│   ├── main/
│   │   ├── index.ts               # Electron main process
│   │   ├── ipc-handlers.ts        # Image loading, preprocessing
│   │   └── image-processor.ts     # Sharp-based resize + pixel extraction
│   ├── renderer/
│   │   ├── index.html
│   │   ├── index.ts               # UI initialization
│   │   ├── ui/
│   │   │   ├── controls.ts        # Sliders, buttons, dropdowns
│   │   │   └── progress.ts        # Progress bar management
│   │   ├── gl/
│   │   │   ├── particle-system.ts # WebGL setup, buffer management
│   │   │   ├── shaders.ts         # Vertex + fragment shader source
│   │   │   └── animation.ts       # Animation loop, timing, easing
│   │   ├── export/
│   │   │   ├── gif-export.ts
│   │   │   ├── mp4-export.ts
│   │   │   └── screenshot.ts
│   │   └── styles/
│   │       └── main.css
│   ├── workers/
│   │   ├── assignment-worker.ts   # Hilbert sort + matching
│   │   ├── refinement-worker.ts   # Swap refinement
│   │   └── shared/
│   │       ├── hilbert.ts         # 3D Hilbert curve encoding
│   │       ├── color.ts           # RGB ↔ LAB conversion
│   │       └── types.ts           # Shared type definitions
│   └── common/
│       ├── constants.ts           # Default settings, limits
│       └── types.ts               # Cross-process types
└── test/
    ├── hilbert.test.ts
    ├── assignment.test.ts
    └── color.test.ts
```

---

## 11. Implementation Order (for Claude Code)

### Sprint 1: Core Pipeline (Get it working)
1. Electron boilerplate with TypeScript
2. Image loading via Sharp (main process)
3. Pixel extraction + LAB conversion
4. Hilbert curve implementation (3D)
5. Sort-match assignment algorithm
6. Basic WebGL point renderer (no animation, just display assigned result)
7. **Milestone: Can see the Obama image reconstructed from any source's pixels**

### Sprint 2: Animation (Make it beautiful)
8. Add start/end position vertex attributes
9. Implement vertex shader with time-based interpolation
10. Basic linear animation loop
11. Add easing functions
12. Add staggered delays
13. Add Bezier curvature to paths
14. **Milestone: Full smooth animation plays**

### Sprint 3: Quality (Make it accurate)
15. Implement swap refinement in Web Worker
16. Add progress reporting from worker
17. Implement parallel refinement (multiple workers)
18. Add quality presets (Draft/Medium/High/Ultra)
19. **Milestone: Visibly better color matching**

### Sprint 4: Polish (Make it shippable)
20. UI: drag-and-drop, file picker, settings panel
21. UI: resolution selector, animation duration slider
22. Export: GIF capture
23. Export: MP4 via ffmpeg.wasm
24. Export: Screenshot
25. Error handling, edge cases
26. **Milestone: Complete app**

---

## 12. Potential Pitfalls & Solutions

| Problem | Solution |
|---------|----------|
| Source has very different color palette from Obama (e.g., solid blue image) | This is expected! The result will look like a heavily color-shifted version of Obama — that's the whole point and it'll look cool. |
| 1024² resolution causes stuttering animation | Default to 512². At 1024², reduce swap iterations and use simpler easing. |
| WebGL context lost on some systems | Add context loss handler, re-initialize buffers and restart animation. |
| Hilbert curve produces banding artifacts in result | The swap refinement step specifically fixes this. Increase swap iterations. |
| Source and target are different aspect ratios | Center-crop both to the same aspect ratio before pixel extraction. |
| SharedArrayBuffer not available (Electron security) | Configure Electron with proper headers (`Cross-Origin-Opener-Policy`, `Cross-Origin-Embedder-Policy`), or fall back to message-passing workers. |
| User wants to change target (not just Obama) | Architect with any target image in mind from day one. Obama is just the default. |

---

## 13. Stretch Goals

- **Multiple easing modes**: particles spiral, bounce, scatter-then-converge
- **Audio sync**: play a sound effect during animation (whoosh, crystallize)
- **Reverse mode**: watch Obama dissolve into the source image
- **Live webcam mode**: grab a frame from webcam, OBAMAFI it in real time
- **Batch mode**: process multiple images, export as a video montage
- **Custom targets**: let user pick any target image, not just Obama
- **Color histogram overlay**: show how the source's color distribution maps onto the target

---

## 14. Key Dependencies

```json
{
  "dependencies": {
    "electron": "^33.x",
    "sharp": "^0.33.x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "electron-builder": "^25.x",
    "vite": "^6.x",
    "@types/node": "^22.x"
  },
  "optionalDependencies": {
    "@ffmpeg/ffmpeg": "^0.12.x",
    "gifenc": "^1.x"
  }
}
```

No heavy ML frameworks. No TensorFlow. No Python. Pure math + WebGL + TypeScript.

---

## 15. Success Criteria

- [ ] Any image can be loaded and OBAMAFIED
- [ ] Animation runs at ≥30fps at 512×512
- [ ] Final frame is recognizably Obama from any source image
- [ ] Assignment computation completes in <10 seconds at 512×512
- [ ] Export works (GIF or MP4)
- [ ] The whole thing looks absolutely sick