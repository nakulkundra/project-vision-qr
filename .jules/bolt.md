## 2026-08-07 - ImageData Creation Bottleneck in High-FPS Canvas Rendering
**Learning:** In hot loops like per-frame canvas rendering, repeatedly calling `ctx.createImageData(width, height)` allocates large arrays per frame, causing massive latency spikes (GC pauses).
**Action:** When the dimensions of a buffer are constant across frames, maintain a persistent file-scoped or class-scoped instance of `ImageData` and reuse it, using `img.data.fill(255)` (or similar logic) to clear it per frame.
## 2026-08-07 - Base45 Codec Hot Loop Optimization
**Learning:** For performance-critical encoding operations, replacing math operations (modulo/division) and multiple string lookups with a precomputed Lookup Table (LUT) in the hot loop yields significant speedups (~4x faster). Similarly, pre-allocating a `Uint8Array` of the exact expected size and directly indexing into it avoids dynamic array resizing and object allocation overheads, outperforming `Array.push` and `Uint8Array.from()`.
**Action:** Use lookup tables (LUTs) for bounded deterministic operations in hot paths. Avoid dynamic array resizing for typed arrays when the target length is calculable upfront.
