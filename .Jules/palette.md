## 2024-05-18 - Async Loading States for Heavy UI Operations
**Learning:** When interacting with files or hardware devices (like `file.arrayBuffer()` or `getUserMedia`), the promise resolution can block or delay significantly. Without immediate visual feedback, users may assume the app is frozen or spam the trigger button, leading to unexpected behaviors or race conditions.
**Action:** Always wrap async initializations for hardware or file reading in a `try/finally` block that disables the trigger button and provides descriptive loading text (e.g., "Starting...", "Processing...") to confirm the system has registered the interaction.
## 2026-08-18 - Prevent focus drop on disabled buttons
**Learning:** When disabling an actively focused button during an async operation in vanilla JS, focus drops to `document.body`.
**Action:** Use `aria-disabled="true"` during the async init, and explicitly shift focus to the next logical control (like a Stop button) before setting `disabled = true`.
