# Section "End here" gating + grip drag fixes

Date: 2026-05-18

## Problem

The `SectionPopover` shows an "End here" button whenever the user opens the popover in create mode, regardless of whether ending a section is meaningful at that point on the timeline. Concretely, the button appears even when:

- the click is before any section starts,
- the click falls inside a region already terminated by an em-dash marker (`—`),
- the click is between two adjacent labelled sections where the "previous" one was already implicitly bounded.

The label "End here" also fails to name what gets ended, so the action is ambiguous even when valid.

A secondary, related problem in `SectionLane`: edge-dragging a section pill misbehaves. The `ew-resize` cursor reverts to `grab`/`grabbing` mid-gesture as the pointer leaves the 12px grip strip, and the right-edge grip seems unreachable in practice.

## Goals

1. Render the "End here" affordance only at click points where a section is actually running and can be truncated. When hidden, the popover reads purely as "create a section."
2. When rendered, the button explicitly names the section it ends, removing ambiguity.
3. Make grip-drag on section pills reliable: a `ew-resize` cursor for the duration of the drag and a hit-testable handle on the right boundary of every adjacent pair.

Out of scope: the `Shift+M` keyboard shortcut, the underlying schema, and any move of the "End here" entrypoint out of the popover.

## Approach

### Gating

Compute a `runningSection: Section | null` outside the popover and pass it in as a prop. The lookup is:

1. Sort `sections` by `start_ms`.
2. Pick the section whose `start_ms < popoverStartMs` and whose successor's `start_ms > popoverStartMs` (or has no successor).
3. If the picked section's `label === END_SECTION_LABEL` (`—`), return `null`. An em-dash already terminated whatever came before; there is nothing further to end at this point.
4. Otherwise return that section.

Render the button only when `runningSection != null` and we are in create mode (`!section`). The existing edit-mode hiding stays as it is.

The lookup lives at the popover's caller (`App.tsx`, where `sections` is already in scope) so the popover stays presentational. `PublicProjectView.tsx` does not open this popover; no change there.

### Button copy

The button text becomes the running section's identity:

- `runningSection.song_name` set → `End "<song_name>" here`
- otherwise `runningSection.label` set → `End "<label>" here`
- otherwise → `End section here` (fallback; in practice unreachable because a section always has one or the other)

The submitted payload is unchanged (`{ kind: 'label', label: END_SECTION_LABEL }`).

### Grip drag fixes

Two distinct bugs in `SectionLane`:

**Cursor flicker during drag.** `cursor: ew-resize` is declared on `.section-grip`, but a `ew-resize` rule on a 12px element only applies while the pointer is inside that element. Pointer-capture on the grip continues to deliver `pointermove` events after the cursor leaves the strip, but the rendered cursor reverts to whatever the new hover target dictates (`grab` on the pill body, `grabbing` on `.section-pill.dragging`, default on empty space). The fix is a global cursor lock for the duration of an active `left-edge` drag: at the start of the gesture set `document.documentElement.style.cursor = 'ew-resize'`, clear at commit/cancel. The lock lives inside the `left-edge` branch of the existing drag callback in `SectionLane` (not in `useDragOnAxis`, since other consumers of that hook want different cursors). A small `useEffect` cleanup must clear the cursor on unmount in case a drag is in flight when the component goes away.

**Right grip unreachable.** Three candidate causes that fit the symptom:

1. The right grip's hit zone (`right: 0; width: 12px`) lives inside the pill, but the next pill begins at the same x-coordinate. There is no geometric overlap, but the visual "right edge of A" is also the visual "left edge of A+1", and the user's pointer typically aims at the latter — which is owned by A+1's left grip. Result: the right grip on A is never the element under the pointer in the most natural aiming spot.
2. The grip's `opacity: 0` reveal only triggers via `.section-pill:hover` on the parent pill, so on rapid pointer entry the grip may be 0-opacity at pointerdown time.
3. The right grip is suppressed entirely on the last section (`c.index < computed.length - 1`), but the user may be aiming at that boundary.

Resolution plan, in order:

1. Reproduce in the browser with devtools open. Inspect `:hover` and the element-from-point at the failing aim spot.
2. If (1) is the cause — and I believe it is — drop the right grip entirely. Every boundary between two adjacent sections is already draggable via the next section's left grip; rendering both is redundant and creates the geometric race. The change is a deletion of the right-grip JSX block plus its CSS rule. The last section retains its middle-drag for repositioning; right-edge resize against the track end is not currently supported and stays unsupported.
3. If (2) or (3) turns out to be the dominant cause instead, fix that one directly (force grip opacity on pointerdown for (2); render the right grip on the last section for (3)) and revisit (1).

I am writing the spec around the (1) fix because it is the most consistent with the user's report ("I never seem to be able to drag on the right boundary"), but the implementation must verify before committing to the deletion.

## Components touched

- `src/client/components/SectionPopover.tsx` — accept `runningSection` prop; gate and re-label the button.
- `src/client/App.tsx` — compute `runningSection` from `sections` and `popoverStartMs` when opening the create popover; pass into `SectionPopover`.
- `src/client/components/SectionLane.tsx` — install cursor lock during a `left-edge` drag; remove the right-grip render block pending in-browser repro.
- `src/client/styles/app.css` — remove the `.section-grip-right` rules if the deletion lands; otherwise add whatever rule the verified root cause requires.
- `src/client/components/SectionPopover.test.tsx` — new and updated cases (below).
- `src/client/components/SectionLane.test.tsx` — left-grip drag still works; cursor lock is set and cleared.

## Edge cases

- Click point before the first section's `start_ms` → no preceding section → button hidden.
- Click point inside an em-dash section (the em-dash *is* the running section by the lookup, but the gate maps em-dash to `null`) → button hidden.
- Click point exactly equal to a section's `start_ms` → the strict `<` in step 2 treats it as "still inside the previous span." Behavior matches existing create-section semantics, which allow placing a new marker at the exact start of another.
- Edit mode → unchanged; "End here" stays hidden in edit mode as today.
- Mobile (`@media (pointer: coarse)`) → grips are display-none today; the gating change still applies. The popover button visibility tracks `runningSection` regardless of viewport.

## Tests

`SectionPopover.test.tsx`:

- Button is absent when `runningSection` is null.
- Button renders with copy `End "Wonderwall" here` when `runningSection.song_name === 'Wonderwall'`.
- Button renders with copy `End "Bridge talk" here` for a free-text running section.
- Clicking the button emits `{ kind: 'label', label: '—' }` (regression check on payload).
- Existing tests that look up the button by its old literal "End here" copy get migrated.

`SectionLane.test.tsx`:

- Left-grip drag commits patched `start_ms` to the section being dragged (existing coverage; confirm unchanged).
- During a left-grip drag preview, `document.documentElement.style.cursor === 'ew-resize'`; after commit or cancel, the cursor is restored to its prior value.
- If the right grip is removed, the test for right-grip behavior gets removed; if the right grip is retained with a fix, the test asserts the fix.

Manual verification (per project rule for UI changes):

- Desktop: confirm the popover button visibility at three representative click points (before first section, inside a song-backed section, between two adjacent sections immediately after an em-dash). Confirm cursor stays `ew-resize` through a drag that wanders off the grip strip. Confirm the boundary between two adjacent pills is draggable via the surviving left grip.
- Mobile (~390px): confirm popover copy and gating; confirm no regression in pill tap/expand behavior.

## Non-goals

- `Shift+M` keyboard shortcut is untouched.
- No DB schema, server route, or storage change.
- Not relocating "End here" outside the create-section popover.
- Not introducing a separate "boundary marker" type. The em-dash convention continues to do this work.

## Open questions

- None blocking. The right-grip root cause is unverified in-browser, but the spec is explicit that the deletion path is conditional on reproducing cause (1).

## Investigation finding (2026-05-18, in-browser)

Reproduced against a project with three adjacent sections (Alpha/Beta/Gamma) in the dev environment.

- `document.elementFromPoint` over the rightmost 12px of the Alpha pill returns `.section-grip section-grip-right`, parent section "Alpha".
- `getComputedStyle(elementFromPoint).cursor` is `ew-resize` on every probed pixel inside the right-grip strip.
- A synthesized `pointerdown` + `pointermove` + `pointerup` on Alpha's right grip:
  - sets `document.documentElement.style.cursor` to `ew-resize` for the duration of the gesture (the Task 3 cursor lock)
  - restores it after `pointerup`
  - patches Beta's `start_ms` from 2000 to 2200 (correct: right grip drags the next pill's start)

The right grip is reachable and the drag works. The user's "I never seem to be able to drag on the right boundary" complaint matches **candidate cause (2)** from the candidate list — the cursor was reverting from `ew-resize` to `grab` / default mid-gesture, which made it feel like the drag wasn't taking. Task 3's cursor lock resolves that. **No further code change is needed** for the right-grip behavior; Task 5 takes the variant 5b "no-op confirmation" path.
