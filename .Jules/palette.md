## 2024-05-18 - Async Loading States for Heavy UI Operations
**Learning:** When interacting with files or hardware devices (like `file.arrayBuffer()` or `getUserMedia`), the promise resolution can block or delay significantly. Without immediate visual feedback, users may assume the app is frozen or spam the trigger button, leading to unexpected behaviors or race conditions.
**Action:** Always wrap async initializations for hardware or file reading in a `try/finally` block that disables the trigger button and provides descriptive loading text (e.g., "Starting...", "Processing...") to confirm the system has registered the interaction.

## 2026-08-21 - Focus Management for Async Buttons
**Learning:** Setting an actively focused button to `disabled = true` immediately drops focus to `document.body`, disrupting keyboard navigation.
**Action:** For async operations, use `aria-disabled="true"` during the loading phase. Once the operation succeeds and the complementary button (like 'Stop') becomes available, shift focus to it before finally setting the original button to disabled.
