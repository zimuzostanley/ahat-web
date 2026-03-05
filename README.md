# ahat-web

Browser-based Android heap dump analyzer. A TypeScript port of [Android's ahat](https://android.googlesource.com/platform/art/+/refs/heads/main/tools/ahat/) that runs entirely client-side — no server required.

## Features

- **HPROF parsing** — Full binary HPROF parser (Java SE / Android format) running in a Web Worker
- **Dominator tree** — Retained size computation with per-heap breakdowns
- **Reachability analysis** — Soft/weak/phantom reference tracking with GC root paths
- **Native sizes** — Extracted from `sun.misc.Cleaner` → `NativeAllocationRegistry` chains
- **Heap diffing** — Compare two heap dumps side-by-side with delta columns
- **ProGuard/R8 deobfuscation** — Load mapping files to deobfuscate class names, fields, and stack frames
- **Bitmap extraction** — Preview `android.graphics.Bitmap` pixel data with duplicate detection
- **ADB capture** — Connect to a device via WebUSB, browse processes, and capture heap dumps directly
- **VMA memory maps** — Visualize `/proc/pid/smaps` with hex viewer and byte-level diffing
- **Search** — Find objects by class name or hex ID
- **Single-file build** — Production build is a single HTML file (via `vite-plugin-singlefile`)

## Getting Started

```bash
npm install
npm run dev       # Start dev server at http://localhost:5173
npm run build     # Production build → dist/
npm run preview   # Preview production build
npm test          # Run test suite
```

Open the app and drag-and-drop an `.hprof` file, or click "Open file" to browse. For ADB capture, click the USB icon and pair with your device.

## Architecture

```
┌──────────────┐    postMessage     ┌────────────────────┐
│   React UI   │ ◄──────────────── │    Web Worker       │
│   (App.tsx)  │ ──────────────►   │  (hprof.worker.ts)  │
│              │   query/result     │                     │
│  Views:      │                    │  hprof.ts  (parser) │
│  - Overview  │                    │  proguard.ts (deob) │
│  - Object    │                    └────────────────────┘
│  - Site      │
│  - Rooted    │    WebUSB          ┌────────────────────┐
│  - Search    │ ◄──────────────── │    ADB modules      │
│  - HexView   │ ──────────────►   │  device.ts          │
│  - Capture   │                    │  capture.ts         │
└──────────────┘                    │  pull.ts            │
                                    └────────────────────┘
```

- **`src/hprof.ts`** — Core HPROF binary parser. Builds dominator tree, computes retained sizes, resolves reachability, extracts native sizes and bitmap data. ~1600 lines, synchronous, runs in worker.
- **`src/hprof.worker.ts`** — Web Worker that holds the parsed snapshot. Main thread sends queries (`getOverview`, `getInstance`, `getRooted`, etc.) and receives plain-JS display records. Also handles diffing and ProGuard map loading.
- **`src/worker-proxy.ts`** — Promise-based proxy for communicating with the worker from the main thread.
- **`src/proguard.ts`** — R8/ProGuard mapping file parser supporting v1/v2/v2.2/v2.4 formats with class, field, and stack frame deobfuscation.
- **`src/App.tsx`** — Main React component. Manages sessions (multiple tabs), routing, diff controls, and ADB connection state.
- **`src/views/`** — Individual view components (Overview, Object, Site, Rooted, Search, HexView, Capture, etc.)
- **`src/adb/`** — WebUSB ADB implementation: device handshake, shell commands, file pull, heap dump capture, and memory info parsing.

## Tech Stack

React 18, TypeScript 5, Vite 6, Tailwind CSS 3, Vitest

## Testing

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
```

Tests cover the HPROF parser, worker queries, URL routing, format functions, ProGuard deobfuscation (with exact parity against Java's `ProguardMapTest.java`), ADB protocol encoding, file pull, capture state machine, and heap diff logic. Some integration tests require external `.hprof` files and skip gracefully if they're not present.

## License

Apache-2.0
