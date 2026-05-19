# Drag-paint mute and solo

Status: design approved, not yet implemented
Date: 2026-05-18

## Problem

In Paperstem today, muting or soloing several tracks at once requires one click per track. DAWs (Pro Tools, Logic, Ableton) all support a press-and-drag gesture on the mute or solo button that flips the state of every track the cursor crosses. The gesture is fast, well-known to anyone who has used a DAW, and Paperstem's row-per-track layout maps onto it cleanly.

This spec adds drag-paint to the M and S pills on each track in `Track.tsx`. Trash and volume are unchanged.

## Behavior

### Brush

A drag-paint gesture has a single "brush" determined at mousedown:

- **Kind**: `mute` or `solo`, set by which pill received the mousedown. Locked for the rest of the gesture.
- **Target state**: the opposite of the originating track's current value for that kind. If the M pill was off when pressed, the brush is "set muted = true"; if it was on, the brush is "set muted = false." Same for S.

The brush is applied to the originating track immediately on mousedown so a plain click (mousedown then mouseup with no movement) behaves identically to today's `onClick` toggle.

### Painting

While the mouse button is held:

- Each `mousemove` re-evaluates the row currently under the cursor via `document.elementFromPoint(x, y).closest('[data-track-idx]')`.
- If the resolved idx is new for this gesture (not in the painted set), the brush is applied to that row and the idx is added to the set.
- If the resolved idx is already in the painted set, nothing happens. This means dragging back across a previously-painted row is a no-op, matching Pro Tools / Logic / Ableton behavior.
- If the cursor is over no `[data-track-idx]` ancestor (e.g. the user dragged outside the track list), nothing happens until the cursor re-enters a row.

### Foreign pill hits

If the cursor passes over an M pill on track A and then over an S pill on track B during the same gesture, the gesture paints `mute` on track B. The brush kind is locked to whichever pill started the gesture; the S pill on B is just part of B's row geometry.

### Commit semantics

State is committed live as each row is crossed — the existing `player.toggleMute(idx)` / `player.toggleSolo(idx)` reducers fire as the cursor enters a new row. There is no separate "preview" visual state; the pill simply flips to its new color. The existing reducer's multi-solo math (any soloed track survives, others are muted) handles solo painting without special-casing.

### End of gesture

A document-level `mouseup` ends the gesture and tears down the document listeners. This fires even if the mouse is released outside the window, so the gesture cannot be left dangling.

### Scope exclusions

- Touch and pointer-events are out of scope. Mobile users continue to tap M/S one track at a time. This can be revisited later.
- Trash, name, swatch, and volume controls are unchanged — no `onMouseDown` wiring.

## Architecture

### New hook: `useDragPaint`

Lives at `src/client/hooks/useDragPaint.ts`. Owns gesture state and document-level listeners.

```ts
type PaintKind = 'mute' | 'solo';

interface UseDragPaintArgs {
  apply: (idx: number, kind: PaintKind) => void;
  // Implementations: pass player.toggleMute and player.toggleSolo,
  // dispatched via the kind argument.
}

interface UseDragPaintResult {
  onPillMouseDown: (idx: number, kind: PaintKind, e: ReactMouseEvent) => void;
}
```

The hook needs to know the brush's `targetState` so it can skip rows whose current state already matches (toggling those would flip them *away* from the brush state — the wrong outcome). Final signature:

```ts
interface UseDragPaintArgs {
  apply: (idx: number, kind: PaintKind, targetState: boolean) => void;
  readState: (idx: number, kind: PaintKind) => boolean;
}
```

The hook:

1. On `onPillMouseDown`, computes `brushTargetState = !readState(originIdx, kind)`, calls `apply(originIdx, kind, brushTargetState)` immediately, seeds the painted set with `originIdx`, attaches document `mousemove` and `mouseup` listeners, and adds a `dragging-vertical` class to `document.body` (CSS sets `cursor: ns-resize` on that class).
2. On document `mousemove`, hit-tests via `elementFromPoint`. If the resolved idx is new for this gesture, add it to the painted set; then if `readState(idx, kind) !== brushTargetState`, call `apply(idx, kind, brushTargetState)`. Same idx or no idx → no-op.
3. On document `mouseup`, removes listeners, clears the painted set, removes the body class.

### Player wiring

`Player.tsx` currently passes `onToggleMute={player.toggleMute}` and `onToggleSolo={player.toggleSolo}` to `Track`. It will instead instantiate `useDragPaint` and pass a single `onPillMouseDown` callback to each `Track`.

`apply` is implemented as:

```ts
const apply = (idx: number, kind: PaintKind, targetState: boolean) => {
  if (kind === 'mute') {
    if (stems[idx].userMuted !== targetState) player.toggleMute(idx);
  } else {
    if (stems[idx].soloed !== targetState) player.toggleSolo(idx);
  }
};
```

`readState` reads `stems[idx].userMuted` or `stems[idx].soloed` from the current player state.

### Track wiring

`Track.tsx` changes:

1. Root element gets `data-track-idx={idx}`.
2. The M and S `<button>` elements drop their `onClick={() => onToggleMute(idx)}` and instead use `onMouseDown={(e) => onPillMouseDown(idx, 'mute', e)}` (and `'solo'` for S). The hook applies the brush on mousedown, so no `onClick` is needed.
3. New prop signature: `onPillMouseDown: (idx, kind, e) => void` replaces `onToggleMute` and `onToggleSolo`.

The trash pill keeps its `onClick`. The pill `<button>` elements should `preventDefault` on mousedown to avoid focus-stealing weirdness mid-drag — but this is a tactical detail.

### CSS

A single new rule in the global stylesheet (likely `src/client/styles.css` or wherever Track styles live):

```css
body.dragging-vertical,
body.dragging-vertical * {
  cursor: ns-resize !important;
}
```

This gives the user a small visual affordance that they're in a paint gesture.

## Testing

### Unit tests for `useDragPaint`

New file `src/client/hooks/useDragPaint.test.ts`. Use `@testing-library/react` + jsdom. Render a small harness with three rows carrying `data-track-idx={0,1,2}` and a hook instance wired to spy `apply` / `readState`. Cases:

- **Mousedown on origin pill calls `apply(originIdx, kind, !readState(originIdx, kind))` exactly once.**
- **Mousedown then mousemove over a new row calls `apply` for that row with the original brush state.**
- **Dragging back across a previously-painted row does not call `apply` again.**
- **Dragging over a row that already matches the brush state does not call `apply`.**
- **Dragging over the M pill of one row, then the S pill of another, paints `mute` on both rows (kind locked).**
- **Mouseup outside the harness still triggers listener teardown** (assert by firing a subsequent mousemove and confirming no more `apply` calls).
- **Mouseup adds and removes the `dragging-vertical` body class.**

### Component test updates

`Track.test.tsx` currently asserts on `onClick`-based toggles for M and S. Update those assertions to use `mouseDown` instead, and update the prop names (`onPillMouseDown` replaces `onToggleMute` / `onToggleSolo`). Trash assertions are unchanged.

### E2E

New Playwright journey under `e2e/` (per CLAUDE.md, this is exactly the "playback timing, zoom/layout, or modals/drawers" category where vitest-only coverage misses real-browser regressions):

- Load a project with at least four tracks.
- Press mouse down on track 0's M pill, drag to track 2's row, release.
- Assert that tracks 0, 1, and 2 are muted in the rendered DOM and track 3 is not.
- Repeat for solo on the same project.
- Final drag: start on track 0's M pill (already muted from step 2), drag across tracks 1 and 2, release. Assert all three are unmuted.

### Verification before completion

Per CLAUDE.md: `npx vitest run`, `npx tsc --noEmit`, `npm run test:e2e`, and a desktop browser smoke test using the Claude Preview MCP. No mobile screenshot needed since this feature is desktop-only; document that explicitly in the PR description.

## Open questions

None — design fully scoped through brainstorming.

## Out of scope

- Touch / pointer-events support.
- Drag-paint on volume sliders or the trash button.
- Visual "speculative" state that's distinct from committed state.
- Keyboard equivalents (e.g. shift-click-range to apply across a range of tracks).
