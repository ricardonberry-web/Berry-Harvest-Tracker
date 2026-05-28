---
name: HID barcode/QR scanner pattern
description: Capturing USB HID scanner input (e.g. Iatech BCST-35) reliably in a React PWA.
---

USB HID barcode/QR scanners behave as keyboards: they emit the scanned code as ultra-fast keystrokes (often ~200+ char/s) followed by Enter. Two consequences:

1. **Don't rely on a focused input.** As soon as the operator identifies a worker and the input unmounts, scanner keystrokes hit `document.body` and silently do nothing — looking like "the scanner always picks the same person."
2. **Don't auto-match on every `onChange`.** Per-keystroke worker lookup picks up intermediate-match worker IDs (e.g. `W00` matches the first `W00x`) and combined with `<datalist>` autocomplete can lock onto the wrong worker.

**Pattern that works:**
- Manual ID input only acts on form submit (Enter / OK button). No `<datalist>`. Set `autoComplete/autoCorrect/spellCheck=off`.
- Add a window `keydown` listener that buffers characters with a fast-key threshold (~60ms gap) and treats `≥ N chars + Enter` as a scan. Skip the buffer when the event target is another text input/textarea/contentEditable so manual typing in weight/name fields still works. When the target IS the manual scan input, let the form's own submit handler process it (don't double-process).
- Route the buffered code through the same handler used by the camera QR scanner so badge switching mid-shift just works.

**Why:** This solves both "no-input-focused" and "auto-match" failure modes at once with one piece of state.

**How to apply:** Any page that needs to accept HID-scanner input even when the operator has moved on to a different UI state should use a top-level window keydown buffer rather than relying on input focus.
