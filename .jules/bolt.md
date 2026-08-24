## 2026-08-07 - ImageData Creation Bottleneck in High-FPS Canvas Rendering
**Learning:** In hot loops like per-frame canvas rendering, repeatedly calling `ctx.createImageData(width, height)` allocates large arrays per frame, causing massive latency spikes (GC pauses).
**Action:** When the dimensions of a buffer are constant across frames, maintain a persistent file-scoped or class-scoped instance of `ImageData` and reuse it, using `img.data.fill(255)` (or similar logic) to clear it per frame.
## 2026-08-24 - Array.from string conversion bottleneck
**Learning:** `Array.from(bytes, x => String.fromCharCode(x)).join('')` generates enormous overhead and garbage when converting large byte payloads to Latin-1, eventually triggering 'Maximum call stack size exceeded' on very large structures due to per-byte string allocation.
**Action:** Use chunked `String.fromCharCode.apply(null, chunk)` inside a loop to process large JS byte arrays safely, yielding order-of-magnitude speedups for file/data payloads.
