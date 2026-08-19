## 2026-08-07 - ImageData Creation Bottleneck in High-FPS Canvas Rendering
**Learning:** In hot loops like per-frame canvas rendering, repeatedly calling `ctx.createImageData(width, height)` allocates large arrays per frame, causing massive latency spikes (GC pauses).
**Action:** When the dimensions of a buffer are constant across frames, maintain a persistent file-scoped or class-scoped instance of `ImageData` and reuse it, using `img.data.fill(255)` (or similar logic) to clear it per frame.
## 2026-08-19 - Pre-allocating Uint8Array in decodeBase45
**Learning:** Dynamically pushing to a standard array inside a tight decoding loop and converting via `Uint8Array.from()` is extremely slow (~60ms for 1MB).
**Action:** Always pre-calculate exact target size and assign values by index into a pre-allocated `Uint8Array`, reducing execution time significantly (to ~8ms).
