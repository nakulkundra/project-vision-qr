## 2024-05-18 - Async Loading States for Heavy UI Operations
**Learning:** When interacting with files or hardware devices (like `file.arrayBuffer()` or `getUserMedia`), the promise resolution can block or delay significantly. Without immediate visual feedback, users may assume the app is frozen or spam the trigger button, leading to unexpected behaviors or race conditions.
**Action:** Always wrap async initializations for hardware or file reading in a `try/finally` block that disables the trigger button and provides descriptive loading text (e.g., "Starting...", "Processing...") to confirm the system has registered the interaction.

## 2024-05-24 - Shifting focus when disabling interactive elements
**Learning:** When disabling an actively focused interactive element (such as a 'Start' button) in vanilla JavaScript, setting `disabled = true` immediately drops focus to `document.body`.
**Action:** Explicitly shift focus to the next logical control (e.g., 'Stop' button). Capture the focus state *before* setting `disabled = true`, and shift focus only *after* the target element has been enabled.
