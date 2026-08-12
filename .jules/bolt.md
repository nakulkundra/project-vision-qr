## 2026-08-07 - ImageData Creation Bottleneck in High-FPS Canvas Rendering
**Learning:** In hot loops like per-frame canvas rendering, repeatedly calling `ctx.createImageData(width, height)` allocates large arrays per frame, causing massive latency spikes (GC pauses).
**Action:** When the dimensions of a buffer are constant across frames, maintain a persistent file-scoped or class-scoped instance of `ImageData` and reuse it, using `img.data.fill(255)` (or similar logic) to clear it per frame.

## 2024-08-12 - Chunked String.fromCharCode.apply for fast byte-to-string conversion
**Learning:** Using `Array.from(bytes, ...).join('')` on typed arrays for string conversion creates massive GC pressure and is >20x slower. However, passing large arrays directly to `String.fromCharCode.apply` causes "Maximum call stack size exceeded".
**Action:** Always use a chunked loop with `String.fromCharCode.apply` and a safe chunk size (like 4096) for large byte array to string conversions in performance-critical paths. Make sure to fallback between `subarray` or `slice` for array compatibility.
