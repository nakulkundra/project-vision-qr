## 2024-05-18 - Async Loading States for Heavy UI Operations
**Learning:** When interacting with files or hardware devices (like `file.arrayBuffer()` or `getUserMedia`), the promise resolution can block or delay significantly. Without immediate visual feedback, users may assume the app is frozen or spam the trigger button, leading to unexpected behaviors or race conditions.
**Action:** Always wrap async initializations for hardware or file reading in a `try/finally` block that disables the trigger button and provides descriptive loading text (e.g., "Starting...", "Processing...") to confirm the system has registered the interaction.

## 2026-08-17 - Prevent focus loss when disabling action buttons
**Learning:** When disabling an actively focused interactive element (such as a 'Start' button) in vanilla JavaScript during async loading, using the `disabled` attribute drops focus to the body. Enabling the next control (like a 'Stop' button) prematurely can create race conditions if users double-click.
**Action:** Use `aria-disabled="true"` during the async loading state to keep focus on the button without breaking accessibility, and only fully disable it once the operation has fully started and it is safe to shift focus to the next control.
