# Project Vision — Offline file transfer via animated QR codes

Move a file from one device to another with **no network and no cables** — purely
through one screen showing a stream of QR codes and another device's camera
reading them. Useful for air-gapped machines, quick key/config hand-offs, or
anywhere two devices can see each other but share no network.

The optical channel is one-way, slow, and lossy (a camera never catches every
frame), so the transfer uses **fountain codes (Luby Transform)**: the sender
broadcasts an *endless* stream of encoded packets and the receiver reconstructs
the file after collecting any `K + a little` of them. Dropped frames don't matter
and no back-channel is needed.

## How it works

```
file ─► split into K blocks ─► LT encoder ─► endless packet stream
                                                   │  each packet = XOR of a
                                                   │  random subset of blocks,
                                                   ▼  identified only by a seed
                                            one QR per packet, animated on screen
                                                   │
                                            camera scans ─► LT peeling decoder
                                                   │
              file ◄─ verify SHA-256 ◄─ reassemble K blocks ◄─ recovered
```

Each QR carries one binary frame:

- **META** — filename, file size, `K`, block size, SHA-256, session id. Sent
  every ~25 frames so a receiver joining mid-stream learns the parameters.
- **DATA** — a 32-bit `seed` + the encoded payload. The seed alone reproduces
  which block indices were XORed (both ends run the same PRNG + degree
  distribution), so the block set is never transmitted.

## Running it

The app is a static site with **no build step**. But `getUserMedia` (the camera)
only works in a **secure context** — HTTPS or `localhost`.

### Quick local test (laptop receives on its own webcam)

```bash
# from the project folder — any static server on localhost works:
python -m http.server 8000
```

Open <http://localhost:8000> on the same machine. `localhost` counts as secure,
so the camera works. Use two browser windows, or the **Self-test** tab, to try it
without a second device.

### Real two-device transfer (phone receives)

A phone loading the page over plain `http://<laptop-ip>` will have the camera
**blocked** (not a secure context). Options:

- **Host over HTTPS** — GitHub Pages, Netlify, or any static host. The phone only
  needs internet to *load the page once*; the transfer itself is fully offline.
- **Local HTTPS server** with a self-signed certificate, e.g.
  `npx http-server -S -C cert.pem -K key.pem`.

Then: on the **sender** device open the **Send** tab, pick a file, press *Start
transmitting*. On the **receiver** device open the **Receive** tab, press *Start
camera*, and point it at the sender's screen. Watch the progress bar; when it
hits 100% and shows *SHA-256 verified*, download the file.

## Verifying without hardware

```bash
npm test        # Node: fountain codec + protocol loopback across sizes & frame loss
```

This runs `test/node-selftest.mjs`, which pushes sender frames through a simulated
lossy channel into the receiver and asserts the reconstructed file is
byte-identical and SHA-256-verified — at up to 50% frame loss. The **Self-test**
tab in the browser runs the same codec loopback plus an **optical loopback** that
renders each frame to a real QR and scans it back with jsQR, exercising the full
generate→scan path.

## Tuning

| Setting          | Effect                                                              |
| ---------------- | ------------------------------------------------------------------ |
| Block size       | Bigger = fewer frames but denser QR (harder to scan). 96–256 good. |
| Error correction | Higher (Q/H) scans better in poor light but shrinks QR capacity.   |
| Frames / sec     | Higher = faster but more misses. 6–10 fps is a good starting point.|

Throughput is inherently low (a few KB/sec), so this targets **small files**
(text, keys, configs, small images), not large media.

## Project layout

```
index.html              UI: Send / Receive / Self-test tabs
src/
  main.js               UI wiring
  protocol.js           frame framing, META/DATA, SHA-256, byte<->latin1 (pure)
  fountain.js           LT encoder + peeling decoder + PRNG + robust soliton (pure)
  qr.js                 qrcode-generator (gen) + jsQR (scan) wrappers (browser)
  sender.js             file -> endless frame stream (pure)
  receiver.js           frames -> reassembled, verified file (pure)
  selftest.js           codec loopback (Node+browser) + optical loopback (browser)
vendor/
  qrcode-generator.js   QR generation (Kazuhiko Arase), vendored for offline use
  jsQR.js               QR scanning, vendored for offline use
test/node-selftest.mjs  `npm test` runner
```

The `pure` modules use no DOM and are unit-testable in Node. Hashing uses the
built-in Web Crypto `SubtleCrypto`; the LT codec is implemented in-repo.

## Limitations / non-goals (this version)

- **Small files only** — the QR channel is slow by nature.
- **No encryption** — SHA-256 here is integrity, not secrecy. Encrypt the file
  before sending if you need confidentiality.
- **No back-channel / acknowledgments** — unnecessary with fountain codes.
## Scanning speed

Frames are carried as **base45** (RFC 9285) in QR **Alphanumeric** mode. base45's
alphabet is exactly QR's alphanumeric charset, so it costs only ~3% more than raw
byte mode yet — unlike raw binary — survives string-only decoders. That lets the
receiver prefer the phone's native, hardware-accelerated **`BarcodeDetector`**
(much faster than software decoding), and fall back to **jsQR** where it isn't
available (e.g. desktop Chrome on Windows/Linux, Firefox). The jsQR fallback
crops each scan to the last-seen QR bounding box so decode cost tracks the QR
size, not the whole camera frame. The Receive tab shows which scanner is active
and a live scans/sec readout.

Because the transfer already has two independent redundancy layers — QR's own
error correction (in-frame) and the fountain code (whole dropped frames) — you
can safely lower QR error correction to **L** on the Send tab to pack more data
per frame; the fountain layer still covers lost frames.
