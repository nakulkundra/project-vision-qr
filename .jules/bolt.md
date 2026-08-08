## 2026-08-07 - ImageData Creation Bottleneck in High-FPS Canvas Rendering
**Learning:** In hot loops like per-frame canvas rendering, repeatedly calling `ctx.createImageData(width, height)` allocates large arrays per frame, causing massive latency spikes (GC pauses).
**Action:** When the dimensions of a buffer are constant across frames, maintain a persistent file-scoped or class-scoped instance of `ImageData` and reuse it, using `img.data.fill(255)` (or similar logic) to clear it per frame.

## 2024-08-08 - Array.from().join() bottleneck in bytesToLatin1
**Learning:** Converting bytes to a string via `Array.from(bytes, x => String.fromCharCode(x)).join('')` is a massive bottleneck for JS arrays/TypedArrays (up to 12x slower) compared to `String.fromCharCode.apply`. `TextDecoder` cannot be used here because 'latin-1' alias actually decodes to Windows-1252 mapping in the Web Encoding API, corrupting bytes 128-159.
**Action:** When implementing exact 1:1 byte-to-char mapping for custom binary protocols, use chunked `String.fromCharCode.apply(null, chunk)` instead of map+join. Conditionally use `.subarray` or `.slice` for the chunks to support both TypedArrays and native Arrays.
