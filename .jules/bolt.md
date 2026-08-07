## 2026-08-07 - ImageData Creation Bottleneck in High-FPS Canvas Rendering
**Learning:** In hot loops like per-frame canvas rendering, repeatedly calling `ctx.createImageData(width, height)` allocates large arrays per frame, causing massive latency spikes (GC pauses).
**Action:** When the dimensions of a buffer are constant across frames, maintain a persistent file-scoped or class-scoped instance of `ImageData` and reuse it, using `img.data.fill(255)` (or similar logic) to clear it per frame.
