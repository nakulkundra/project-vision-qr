## 2024-05-18 - Async Loading States for Heavy UI Operations
**Learning:** When interacting with files or hardware devices (like `file.arrayBuffer()` or `getUserMedia`), the promise resolution can block or delay significantly. Without immediate visual feedback, users may assume the app is frozen or spam the trigger button, leading to unexpected behaviors or race conditions.
**Action:** Always wrap async initializations for hardware or file reading in a `try/finally` block that disables the trigger button and provides descriptive loading text (e.g., "Starting...", "Processing...") to confirm the system has registered the interaction.
## 2024-05-18 - Focus management for dynamic buttons
**Learning:** When a currently focused element becomes disabled (like a "Start" button), keyboard focus is lost, dropping the user back to the start of the page.
**Action:** Explicitly shift focus to the next logical control (e.g. the "Stop" button) or dynamically inserted actionable elements (e.g. "Download") to preserve accessibility.
