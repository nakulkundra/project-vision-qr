## 2024-05-18 - Async Loading States for Heavy UI Operations
**Learning:** When interacting with files or hardware devices (like `file.arrayBuffer()` or `getUserMedia`), the promise resolution can block or delay significantly. Without immediate visual feedback, users may assume the app is frozen or spam the trigger button, leading to unexpected behaviors or race conditions.
**Action:** Always wrap async initializations for hardware or file reading in a `try/finally` block that disables the trigger button and provides descriptive loading text (e.g., "Starting...", "Processing...") to confirm the system has registered the interaction.
## 2026-08-22 - Preserve Keyboard Focus During Async Initialization
**Learning:** When an actively focused button triggers an asynchronous operation, immediately setting `disabled = true` causes focus to drop to `document.body`, breaking keyboard navigation.
**Action:** Temporarily use `aria-disabled="true"` with a JS guard during the async setup, and shift focus to the next logical control *before* finally setting `disabled = true`.
