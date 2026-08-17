## 2026-08-06 - Implement Content Security Policy for App Protection
**Vulnerability:** The application previously lacked a Content Security Policy (CSP), leaving it potentially more vulnerable to Cross-Site Scripting (XSS) or malicious data injection attacks.
**Learning:** As this app leverages local processing and generates file blobs natively (since it is an offline file transfer application), the CSP required special allowances for `blob:` schemas in `default-src` and `img-src` as well as `unsafe-inline` for styles and `unsafe-eval` for scripts to support development tools. This represents a balance between offline app functionality and modern web security controls.
**Prevention:** Always implement a strict Content Security Policy when deploying front-end applications, explicitly tailoring it to the application's unique resource requirements (e.g., `data:` and `blob:` schemas for client-side generation) to provide defense-in-depth against code execution.
## 2026-08-17 - Predictable Randomness in Session/Seed Generation
**Vulnerability:** Predictable Math.random() was used for generating session IDs and base seeds in sender.js.
**Learning:** Using weak RNG can allow attackers to predict transmission streams or session parameters.
**Prevention:** Use Web Crypto API (crypto.getRandomValues) with a robust feature-detection fallback for cross-platform code, maintaining original bitwise constraints.
