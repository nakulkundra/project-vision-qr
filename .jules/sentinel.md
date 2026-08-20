## 2026-08-06 - Implement Content Security Policy for App Protection
**Vulnerability:** The application previously lacked a Content Security Policy (CSP), leaving it potentially more vulnerable to Cross-Site Scripting (XSS) or malicious data injection attacks.
**Learning:** As this app leverages local processing and generates file blobs natively (since it is an offline file transfer application), the CSP required special allowances for `blob:` schemas in `default-src` and `img-src` as well as `unsafe-inline` for styles and `unsafe-eval` for scripts to support development tools. This represents a balance between offline app functionality and modern web security controls.
**Prevention:** Always implement a strict Content Security Policy when deploying front-end applications, explicitly tailoring it to the application's unique resource requirements (e.g., `data:` and `blob:` schemas for client-side generation) to provide defense-in-depth against code execution.
## 2026-08-20 - Predictable Random Number Generation for Session and Seed
**Vulnerability:** Predictable Math.random() was used to generate sessionId and base seed for data payloads.
**Learning:** Math.random() is not cryptographically secure and can be guessed, which could allow a malicious receiver or sender to predict or collide with session data or packet streams.
**Prevention:** Always use Web Crypto API (crypto.getRandomValues) for security-sensitive or unique identifier generation, with fallback to Math.random() only if necessary.
