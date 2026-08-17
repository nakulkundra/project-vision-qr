## 2026-08-07 - ImageData Creation Bottleneck in High-FPS Canvas Rendering
**Learning:** In hot loops like per-frame canvas rendering, repeatedly calling `ctx.createImageData(width, height)` allocates large arrays per frame, causing massive latency spikes (GC pauses).
**Action:** When the dimensions of a buffer are constant across frames, maintain a persistent file-scoped or class-scoped instance of `ImageData` and reuse it, using `img.data.fill(255)` (or similar logic) to clear it per frame.
## 2026-08-17 - Optimize Base45 decoding with pre-allocation
**Learning:** `Uint8Array.from([])` dynamically pushing per decode iteration inside a hot loop (like base45 decoding) incurs high garbage collection and reallocation costs.
**Action:** When translating formats where output string lengths are predictable (like base45 where 3 chars -> 2 bytes), precalculate the output length (`Math.floor(n/3)*2 + ...`) and directly populate a pre-allocated `Uint8Array` by index. This saves a ~3x performance cost in environments like V8.
