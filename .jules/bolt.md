## 2026-08-07 - ImageData Creation Bottleneck in High-FPS Canvas Rendering
**Learning:** In hot loops like per-frame canvas rendering, repeatedly calling `ctx.createImageData(width, height)` allocates large arrays per frame, causing massive latency spikes (GC pauses).
**Action:** When the dimensions of a buffer are constant across frames, maintain a persistent file-scoped or class-scoped instance of `ImageData` and reuse it, using `img.data.fill(255)` (or similar logic) to clear it per frame.

## 2026-08-22 - Base45 Math Bottleneck and TypedArray Coercion in Hot Paths
**Learning:** Dynamic string concatenations and modulo math inside encoding loops (`encodeBase45`), along with array mapping (`Array.from`) over large `Uint8Array`s, introduce massive GC pauses and CPU overhead when generating high-FPS QR streams. Standard `TextDecoder` doesn't support raw 0-255 mappings correctly.
**Action:** Precompute exact-match Lookup Tables (LUTs) for 16-bit to string mappings to eliminate math and concatenations. Use `String.fromCharCode.apply` with safe chunking (4096) for large array to string coercion to bypass stack limits and avoid `.map` coercion overhead.
