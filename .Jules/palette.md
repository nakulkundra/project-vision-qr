## 2024-05-18 - Async Loading States for Heavy UI Operations
**Learning:** When interacting with files or hardware devices (like `file.arrayBuffer()` or `getUserMedia`), the promise resolution can block or delay significantly. Without immediate visual feedback, users may assume the app is frozen or spam the trigger button, leading to unexpected behaviors or race conditions.
**Action:** Always wrap async initializations for hardware or file reading in a `try/finally` block that disables the trigger button and provides descriptive loading text (e.g., "Starting...", "Processing...") to confirm the system has registered the interaction.
## 2026-08-24 - Prevent focus drop during async button actions
**Learning:** Disabling an actively focused button during an async operation immediately drops focus to the document body.
**Action:** Temporarily use `aria-disabled="true"` with a JS guard during the async setup, then explicitly shift focus to the next logical control before applying `disabled = true`.
