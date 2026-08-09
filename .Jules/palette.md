## 2024-05-18 - Async Loading States for Heavy UI Operations
**Learning:** When interacting with files or hardware devices (like `file.arrayBuffer()` or `getUserMedia`), the promise resolution can block or delay significantly. Without immediate visual feedback, users may assume the app is frozen or spam the trigger button, leading to unexpected behaviors or race conditions.
**Action:** Always wrap async initializations for hardware or file reading in a `try/finally` block that disables the trigger button and provides descriptive loading text (e.g., "Starting...", "Processing...") to confirm the system has registered the interaction.

## 2024-05-20 - Focus Management on Disabled Interactive Elements
**Learning:** When disabling an actively focused element (like a 'Start' or 'Stop' button) in vanilla JavaScript during asynchronous or state-toggling operations, the browser will lose focus and screen readers or keyboard navigation might reset to the top of the document, creating a disorienting user experience.
**Action:** Always check if the element being disabled is currently the active element (`document.activeElement === btn`), and if so, explicitly shift focus to the next logical control (e.g., the complementary 'Stop' button or a dynamically inserted download link) when it becomes enabled.
