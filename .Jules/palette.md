## 2024-05-18 - Async Loading States for Heavy UI Operations
**Learning:** When interacting with files or hardware devices (like `file.arrayBuffer()` or `getUserMedia`), the promise resolution can block or delay significantly. Without immediate visual feedback, users may assume the app is frozen or spam the trigger button, leading to unexpected behaviors or race conditions.
**Action:** Always wrap async initializations for hardware or file reading in a `try/finally` block that disables the trigger button and provides descriptive loading text (e.g., "Starting...", "Processing...") to confirm the system has registered the interaction.

## 2024-08-08 - Explicit Focus Shifting After Disabling Active Elements
**Learning:** When a user clicks a button (e.g., "Start") that triggers an async operation or state change and the UI subsequently disables that button, the browser loses keyboard focus and resets to the top of the document (`<body>`). This completely breaks keyboard navigation and screen reader flow.
**Action:** Always explicitly shift focus to the next logical, interactive element (e.g., the "Stop" button) immediately after disabling the currently active element. Apply this symmetrical pattern for corresponding cancel/stop actions.
