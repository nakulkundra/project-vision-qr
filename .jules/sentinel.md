## 2026-08-06 - Implement Content Security Policy for App Protection
**Vulnerability:** The application previously lacked a Content Security Policy (CSP), leaving it potentially more vulnerable to Cross-Site Scripting (XSS) or malicious data injection attacks.
**Learning:** As this app leverages local processing and generates file blobs natively (since it is an offline file transfer application), the CSP required special allowances for `blob:` schemas in `default-src` and `img-src` as well as `unsafe-inline` for styles and `unsafe-eval` for scripts to support development tools. This represents a balance between offline app functionality and modern web security controls.
**Prevention:** Always implement a strict Content Security Policy when deploying front-end applications, explicitly tailoring it to the application's unique resource requirements (e.g., `data:` and `blob:` schemas for client-side generation) to provide defense-in-depth against code execution.
## 2026-08-27 - Predictable Randomness in Sender Seed
**Vulnerability:** Weak PRNG (`Math.random()`) was used to generate session IDs and transmission seeds in `src/sender.js`.
**Learning:** Using `Math.random()` for critical seeds can lead to predictable payload patterns.
**Prevention:** Use `crypto.getRandomValues()` with a robust feature-detection fallback for generating security-sensitive random numbers, ensuring existing bit constraints (e.g., 16-bit alignment) are strictly preserved.
