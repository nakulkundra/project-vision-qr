## 2026-08-07 - ImageData Creation Bottleneck in High-FPS Canvas Rendering
**Learning:** In hot loops like per-frame canvas rendering, repeatedly calling `ctx.createImageData(width, height)` allocates large arrays per frame, causing massive latency spikes (GC pauses).
**Action:** When the dimensions of a buffer are constant across frames, maintain a persistent file-scoped or class-scoped instance of `ImageData` and reuse it, using `img.data.fill(255)` (or similar logic) to clear it per frame.

## 2024-05-24 - V8 Performance for bytes-to-string mapping
**Learning:** In V8, `Array.from(bytes, ...).join('')` has catastrophic memory and GC overhead for large Uint8Arrays because it allocates a new Array of massive size and maps every byte to a new 1-character String object before joining them all. Using `String.fromCharCode.apply(null, chunk)` is far more memory efficient and fast (~15x speedup).
**Action:** When converting large typed arrays to strings, strictly avoid `Array.from()` map+join. Instead, use chunked `String.fromCharCode.apply` inside a `for` loop (with safe chunk sizes like 4096 to avoid max call stack limits) and a fallback for typed arrays without `subarray`.
