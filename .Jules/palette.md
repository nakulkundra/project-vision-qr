## 2024-05-18 - Async Loading States for Heavy UI Operations
**Learning:** When interacting with files or hardware devices (like `file.arrayBuffer()` or `getUserMedia`), the promise resolution can block or delay significantly. Without immediate visual feedback, users may assume the app is frozen or spam the trigger button, leading to unexpected behaviors or race conditions.
**Action:** Always wrap async initializations for hardware or file reading in a `try/finally` block that disables the trigger button and provides descriptive loading text (e.g., "Starting...", "Processing...") to confirm the system has registered the interaction.
## 2026-08-20 - Maintaining Keyboard Focus During Async Button Actions
**Learning:** Disabling a focused button immediately during an async operation drops keyboard focus to `document.body`, breaking accessibility.
**Action:** Temporarily use `aria-disabled="true"` to prevent multi-clicks while keeping focus. After the async operation completes, shift focus to the next logical control before finally setting `disabled = true`.
