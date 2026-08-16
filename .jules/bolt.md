## 2026-08-07 - ImageData Creation Bottleneck in High-FPS Canvas Rendering
**Learning:** In hot loops like per-frame canvas rendering, repeatedly calling `ctx.createImageData(width, height)` allocates large arrays per frame, causing massive latency spikes (GC pauses).
**Action:** When the dimensions of a buffer are constant across frames, maintain a persistent file-scoped or class-scoped instance of `ImageData` and reuse it, using `img.data.fill(255)` (or similar logic) to clear it per frame.

## 2023-10-25 - Optimize bytesToLatin1 with chunked apply
**Learning:** In modern V8 engines (Node.js/browser), converting large typed arrays to strings using `Array.from(bytes, x => String.fromCharCode(x)).join('')` is significantly slower than chunked `String.fromCharCode.apply(null, chunk)` due to the overhead of array allocation, callback invocation per element, and garbage collection.
**Action:** Use a chunked `String.fromCharCode.apply` loop for fast byte-array-to-string conversion, carefully applying a safe chunk size (e.g., 4096) to prevent stack overflows, and using `subarray` for typed arrays or `slice` for standard arrays.
