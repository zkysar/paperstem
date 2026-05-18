# Presence avatar popovers — design

Status: approved through brainstorming, ready for implementation planning.
Date: 2026-05-17.

## Goal

Make the project-presence avatars self-explanatory. Today they render as initial-only circles with a hover tooltip — fine for users who already know what they are, opaque to everyone else. Clicking should open a small popover that identifies the viewer (name + state), matching Google Docs convention.

## Non-goals

- "Follow this person" / jump to their playhead. Defer.
- Server changes — all required data (`userId`, `displayName`, `state`, `lastBeatAt`) is already on the presence row.
- Making the anonymous-viewers chip (`👁 N`) interactive — we have no per-viewer info to reveal.
- Adding email to the popover. The name (or email local-part as fallback) is enough.
- A mobile-specific bottom-sheet variant. One popover implementation, viewport-aware positioning, works for both.

## Behavior

- **Member avatars** become `<button>` elements. Click toggles a `<PresencePopover />` anchored to that avatar.
- **Single-viewer popover** shows:
  - A 40px version of the same avatar (background color from `colorForAnnotationAuthor`-style palette).
  - The **name**: `displayName` if present and non-empty, otherwise the local-part of the email. The presence row carries `displayName`; the email local-part fallback is computed server-side and added to the row payload so the client has it without an extra fetch. If neither is available, fall back to `"Unknown"`.
  - The **state line**: `"Active now"` if `state === 'active'`, otherwise `"Idle X minutes ago"` (or `"Idle just now"` for <1 minute, `"Idle X hours ago"` for ≥60 minutes).
- **Overflow chip** (`+N`) also becomes a `<button>`. Click opens a list popover containing one row per *non-visible* viewer (avatar + name + state). The 3 visible avatars are NOT duplicated in this list. The list uses the same ordering rule as the main row (active first by recency, then idle by recency) — i.e. the same slice that would have been the 4th, 5th, ... items.
- **Anonymous chip** (`👁 N`) is unchanged — no popover, no interactivity.
- Only one popover open at a time. Clicking a different trigger closes the open one and opens the new one.
- **Dismissal:** click anywhere outside the popover (and outside its trigger), OR press `Escape`. Either restores focus to the trigger button.
- **Tooltip on hover** stays as a quick preview (no behavior change there).

## Components

- **New: `src/client/components/PresencePopover.tsx`** — pure render. Props: `mode: 'single' | 'list'`, `rows: PresenceRowDto[]`, `triggerRect: DOMRect`, `onClose: () => void`. Renders the appropriate body and positions itself via `positionPopover` (see below). Owns `Escape`-key handling and outside-click detection. Rendered via `createPortal` to `document.body` so it isn't trapped by a `transform`-ed or `overflow: hidden` ancestor (the picker row has `overflow-x` clipping that would otherwise hide the popover).
- **Modified: `src/client/components/PresenceAvatars.tsx`** —
  - Avatars/overflow chip become `<button type="button">` with the existing classes plus the necessary aria attrs.
  - Local `useState<{ kind: 'avatar'; userId: string } | { kind: 'overflow' } | null>` tracks the open popover.
  - Refs collected per trigger via `useRef<Map<string, HTMLButtonElement>>` so the popover can compute position from the trigger's `getBoundingClientRect()`.
- **New helper: `formatPresenceState(row, now)`** — lives in `src/client/lib/presence-format.ts`. Returns the state line string. Pure function, easy to unit test with mocked `now`.
- **New helper: `positionPopover(triggerRect, popoverSize, viewport)`** — returns `{ top, left }`. Default: anchored 8px below the trigger, left-aligned with the trigger. If `left + popoverWidth > viewport.width - 8`, shift left so the right edge sits 8px from the viewport edge. If `top + popoverHeight > viewport.height - 8`, flip to anchor 8px ABOVE the trigger. Same file as `formatPresenceState`.

## Server change (small)

The presence payload currently includes `userId`, `displayName`, `state`, `lastBeatAt`. To support the email-local fallback, the server adds an `emailLocal: string | null` field per row — derived from the cookie-resolved `User.email` by splitting on `@` and taking `[0]`. Anonymous rows stay as today (no userId, no email).

This is the minimum needed. Full email is NOT exposed because (a) it's not needed for the popover, and (b) it would leak member emails to other band members through the WS broadcast.

## A11y

- Each avatar button: `aria-haspopup="dialog"`, `aria-expanded={isOpen}`, keeps existing `aria-label`. Overflow button similar.
- Popover wrapper: `role="dialog"`, `aria-label="<name> presence details"` (or `"All viewers"` for overflow mode).
- On open: move focus to the popover's root. On close: restore focus to the trigger button.
- `Escape` closes regardless of focus position (listener attached at popover mount).
- Tooltip (`title=` attribute) stays for hover preview, which screen readers may also announce.

## Mobile / viewport-aware positioning

Single popover implementation, no breakpoint logic. The `positionPopover` helper handles edge cases that matter on small viewports (right-edge clip, bottom-edge flip). Avatars stay 24px — the existing tap target is small but workable. If finger-misses prove a real problem in practice, the fix is increasing the button's invisible padding (not the visible avatar size). Tracking that as a possible follow-up, not in scope.

## Testing

- **`PresenceAvatars.test.tsx`** — extended:
  - Click avatar opens single-viewer popover with the right name + state.
  - Click again on the same avatar closes it.
  - Click a different avatar closes the first and opens the second (only one open).
  - Pressing `Escape` closes the popover and returns focus to the trigger.
  - Click outside dismisses.
  - Overflow chip click opens the list popover with ONLY the non-visible viewers, in the same active-then-idle ordering as the main row.
- **New: `src/client/lib/presence-format.test.ts`** — exhaustive cases for `formatPresenceState` (active, idle <60s, idle minutes, idle hours) and `positionPopover` (default, right-clip, bottom-flip, both at once).
- **Server side** — extend `presence-ws.test.ts` to assert the `emailLocal` field is present on member rows and `null` on anonymous rows.

## Out of scope (deferred)

- Follow / jump-to-playhead.
- Full email visible to other members.
- Click on anonymous chip.
- Bigger touch targets / bottom-sheet on mobile.
- Sticky popovers that survive scroll.
