## 2024-05-18 - Fix Weak Random Number Generation in Seed
**Vulnerability:** Weak random number generation using `Math.random()` for critical session and fountain-codec seed initialization.
**Learning:** The Web Crypto API (`crypto.getRandomValues`) provides cryptographically secure pseudo-random number generation but isn't always available in all Node.js execution environments without `globalThis.crypto`. Fallbacks must check for `crypto` existence and `crypto.getRandomValues` function type to remain safe across environments while securely falling back when strictly necessary.
**Prevention:** Always default to Web Crypto APIs for generation of session IDs, encryption keys, and seeds, using `Math.random()` strictly as an absolute last resort with proper feature-detection.
