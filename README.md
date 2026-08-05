<div align="center">

<img src="icons/icon-192.png" width="96" height="96" alt="Project Vision" />

# Project Vision

**Move a file between two devices with no network, no cables, no pairing —
through a stream of animated QR codes.**

[**▶ Open the app**](https://nakulkundra.github.io/project-vision-qr/) &nbsp;·&nbsp;
Installable · Works fully offline · No build step · No dependencies to install

</div>

---

One device shows a rapidly changing QR code. The other points its camera at the
screen. The file rebuilds itself on the far side, byte-for-byte, verified by
SHA-256. Nothing touches a network at any point.

Useful for air-gapped machines, moving a key or config off a locked-down box,
hotel Wi-Fi you don't trust, or any two devices that can see each other but
share nothing else.

## How it works

The optical channel is **one-way, slow, and lossy** — a camera never catches
every frame, and there is no back-channel to ask for a resend. So the transfer
uses **fountain codes** (Luby Transform): the sender broadcasts an *endless*
stream of encoded packets, and the receiver rebuilds the file from *any*
`K + ~20%` of them. Dropped frames simply stop mattering.

```
    SENDER                                             RECEIVER
 ┌──────────┐                                       ┌──────────┐
 │   file   │                                       │   file   │
 └────┬─────┘                                       └────▲─────┘
      │ split into K blocks                              │ verify SHA-256
      ▼                                                  │
 ┌──────────┐                                       ┌────┴─────┐
 │ LT       │  each packet = XOR of a random         │ peeling  │
 │ encoder  │  subset of blocks, identified          │ decoder  │
 └────┬─────┘  only by a 32-bit seed                 └────▲─────┘
      │                                                   │
      ▼                    ((( optical )))                │
 ┌──────────┐        ~~~~~~~~~~~~~~~~~~~~~~~~~      ┌────┴─────┐
 │ animated │  ───▶  screen  ·············▶  camera │ QR scan  │
 │ QR codes │        ~~~~~~~~~~~~~~~~~~~~~~~~~      └──────────┘
 └──────────┘         lossy, one-way, no ACK
```

Each QR carries one binary frame:

| Frame | Payload | Sent |
| --- | --- | --- |
| **META** | filename, file size, `K`, block size, SHA-256, session id | every ~20 frames, so a receiver can join late |
| **DATA** | 32-bit `seed` + encoded block | every other frame |

The `seed` alone reproduces *which* blocks were XORed — both ends run the same
seeded PRNG and degree distribution, so the block set is never transmitted.

## Quickstart

### Try it with no second device

```bash
python -m http.server 8000
```

Open <http://localhost:8000> → **Self-test** tab → run both loopbacks. This
exercises the codec and the real generate→scan pipeline with no camera at all.

### Real transfer, phone ← laptop

1. Open the **[live app](https://nakulkundra.github.io/project-vision-qr/)** on
   both devices.
2. **Sender:** *Send* tab → pick a small file → **Start transmitting**.
3. **Receiver:** *Receive* tab → **Start camera** → point it at the other screen.
4. Watch the progress bar. At 100% you get **✓ SHA-256 verified** and a download.

> **The camera needs HTTPS.** `getUserMedia` only works in a secure context, so a
> phone on plain `http://<laptop-ip>` will have its camera silently blocked. Use
> the HTTPS link above (or any static host). It needs the network only to *load
> the page once* — you can switch the phone to airplane mode before transferring
> and it still works.

## Install it

The app is a **PWA**: a service worker precaches the entire shell, so after one
load it runs with no network at all.

- **Android / Chrome / Edge** — tap **Install app** in the header (or the
  browser's install icon).
- **iOS Safari** — *Share → Add to Home Screen*. (Apple provides no install
  prompt; this is expected, not a bug.)

The header shows **✓ Ready to work offline** once caching completes, and a
**BUILD** badge so you can confirm at a glance which version a device is running.
If a device ever looks stale or a control seems dead, tap **↻ Force update** — it
clears every cache and service worker and reloads from the network.

## Tuning throughput

Throughput is `bytes per QR × QR codes decoded per second`. Both factors are
capped by the receiving camera, so the right setting depends on the *phone*, not
the sender.

| Preset | Block · ECC · fps | Use when |
| --- | --- | --- |
| **Reliable** | 128 · M · 8 | Default. Works on any phone, any decoder. |
| **Turbo** | 512 · L · 15 | Only pays off when the receiver reports `native` (see below). |

The Send tab shows the resulting QR size, **px/module**, and a throughput
ceiling, and warns when a setting is too dense to scan. The Receive tab reports
which decoder is active, the granted camera resolution, scans/sec and live KB/s:

```
Scanning (native) · cam 1920×1080@30fps · ~24/s · QRs seen 412 · decoded 409 · skipped 88
```

**If it says `jsQR`, keep Reliable.** jsQR is a software decoder — denser codes
cost more to decode *and* fail more often, so Turbo can end up slower than
Reliable. `native` means the phone's hardware `BarcodeDetector` is doing the
work, and Turbo becomes worth it.

Two independent redundancy layers exist — QR's own error correction (in-frame)
and the fountain code (whole dropped frames) — which is why ECC **L** is safe
to use: the fountain layer already covers what L gives up.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Camera won't start | Not a secure context. Use HTTPS or `localhost`. |
| No install prompt on iPhone | Expected — use *Share → Add to Home Screen*. |
| A button looks present but does nothing | Stale cached script. Tap **↻ Force update**. |
| Sees the QR but nothing is received | Check the Receive line: if `QRs seen` climbs but `decoded` stays 0, the QR is too dense — tap **Reliable**. |
| Progress bar freezes partway | The sender restarted (e.g. a preset was tapped). The receiver now re-locks automatically; give it a few frames. |
| Very slow | Confirm `native` vs `jsQR` in the Receive line and pick the matching preset. More light and a steadier hand both raise the decode rate. |

## Testing

```bash
npm test
```

Runs two suites, neither of which needs a camera or a second device:

- **`test/node-selftest.mjs`** — pushes a file through a simulated lossy channel
  and asserts byte-identical, SHA-256-verified reconstruction from 1 B to 100 KB
  at up to **50% frame loss**.
- **`test/regress.mjs`** — 11 targeted regression tests locking in previously
  shipped bugs: fail-closed frame decoding, both sender-restart recovery paths,
  and single-shot completion.

The in-app **Self-test** tab additionally runs an *optical* loopback that renders
each frame to a real QR and scans it back through jsQR, exercising the full
generate→scan path in the browser.

## Project layout

No build step, no framework, no npm dependencies. Plain ES modules.

```
index.html              UI + theme (Send / Receive / Self-test)
manifest.webmanifest    PWA manifest (installable, standalone)
service-worker.js       Offline shell — network-first, cache fallback
src/
  main.js               UI wiring, diagnostics, install & update handling
  sender.js             file  -> endless fountain-coded frame stream
  receiver.js           frames -> reassembled, SHA-verified file
  fountain.js           LT encoder + peeling decoder + robust soliton
  protocol.js           frame framing (META/DATA), SHA-256, block splitting
  transport.js          base45 (RFC 9285) wire encoding, dual-format decode
  qr.js                 QR generation + Scanner (native fast path, jsQR fallback)
  selftest.js           codec + optical loopbacks
vendor/
  qrcode-generator.js   QR generation  (vendored, offline)
  jsQR.js               QR scanning    (vendored, offline)
test/                   node-selftest.mjs, regress.mjs
icons/                  app icons (192, 512, maskable)
```

Hashing uses the built-in Web Crypto `SubtleCrypto`. The fountain codec is
implemented in-repo. The `pure` modules (`fountain`, `protocol`, `transport`,
`sender`, `receiver`) touch no DOM and are unit-testable under Node.

## Design notes

A few decisions that were driven by measurement rather than intuition:

- **base45 + QR Alphanumeric mode**, not raw byte mode. base45's alphabet is
  exactly QR's alphanumeric charset, costing only ~3% over raw binary — but
  unlike binary it survives string-only decoders, which is what unlocks the
  phone's hardware `BarcodeDetector`.
- **Crop, don't scale.** Bounding jsQR's input by downscaling a frame
  `1920→960` put an 81-module QR at ~3.6 px/module and *nothing decoded at all*
  (jsQR needs ~5 px/module at that density). Cropping to the tracked QR region
  is safe; scaling is not.
- **Resolution follows the decoder.** A full 1080p frame costs jsQR ~615 ms per
  decode (~2 scans/sec), so the software path requests 720p and only the
  hardware path gets 1080p.
- **One fixed QR version per session.** The small META frame used to render at a
  smaller version, resizing the code every ~20 frames; that made the receiving
  camera re-hunt focus and exposure. Pinning the version removed it.
- **Denser is not always faster.** At Turbo on the software path the decode rate
  measured **0.33** — one frame in three — making it net *slower* than Reliable.
- **Avoid QR version 23 at ECC L.** The vendored jsQR cannot decode it (verified
  by sweeping versions 5–40); the sender steps to v24 instead.

## Limitations

- **Small files.** The channel is inherently slow — a few KB/s. Text, keys,
  configs, small images. Not media.
- **No encryption.** SHA-256 here is integrity, not secrecy. Encrypt before
  sending if you need confidentiality.
- **No back-channel.** By design — fountain codes make acknowledgements
  unnecessary.

## License & credits

QR generation by [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)
(Kazuhiko Arase, MIT) and scanning by [jsQR](https://github.com/cozmo/jsQR)
(MIT), both vendored locally so the app never needs a network.
