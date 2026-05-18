# Reply thread redesign — flatten the conversation

**Date:** 2026-05-18
**Affects:** `src/client/components/ReplyThread.tsx`, `src/client/components/ReplyCard.tsx`, `src/client/components/CommentPopover.tsx`, `src/client/components/CommentBottomSheet.tsx`, `src/client/styles/app.css`

## Problem

The reply UX inside the comment popover feels half-baked. The visual nesting is the worst of it: each reply lives in a bordered, off-white card (`.reply-card`), inside a left-bordered thread rail (`.reply-thread-list`), inside the popover itself (`.comment-popover`). Three frames where one would do. The card's white background also clashes with the popover's cream `--paper` tone, making replies read as a different species than the parent comment.

The thread also asks for too many clicks. Users open the popover, then have to click "▸ N replies" to see them, then click "Reply" to get a composer. None of that hiding is doing useful work — by the time the popover is open, the user is committed to the conversation.

## Decision

Flatten the reply thread into a single inline conversation inside the popover. Drop the per-reply card chrome and the thread rail. Always show all replies eagerly. Make the reply composer permanently visible at the bottom of the popover.

## Design

Three popover states define the surface:

**No replies.** Parent comment header + body + reactions row + "Reply…" pill composer. No hairline divider, no thread chrome at all.

**With replies.** Same parent block, then a single thin hairline (`1px solid var(--rule-2)`), then a flat list of replies, then the composer pill. Each reply row is: small avatar (18px), author name, relative timestamp, body, optional reactions. Replies on hover (or focus-within) reveal a `⋯` icon at the right edge that holds Edit/Delete for own replies.

**Composing.** Click the pill → it morphs into a textarea with Cancel/Reply buttons. Cmd/Ctrl+Enter sends, Esc cancels. On send, the textarea collapses back into the pill and the new reply appears at the bottom of the list.

### Design rules

1. **One frame, not three.** No card border or background on replies. No left-border rail around the list. Replies are flat rows that breathe inside the popover's existing padding.
2. **Replies echo the parent's pattern.** Avatar + author + timestamp + body, scaled down (18px avatar vs the parent's 22px; `--fs-xs` meta vs `--fs-sm`). Reading top-to-bottom reads as one conversation.
3. **Composer always present.** A "Reply…" pill with the current user's avatar sits below the last reply (or below the reactions row when no replies exist). No "Reply" CTA button anywhere else.
4. **Hairline only when there's a thread.** Empty thread: no divider. With replies: one hairline between the parent's reactions row and the first reply.
5. **Eager load.** Replies fetch when the popover opens, not on click. The "▸ N replies" expand affordance is gone. The reply count remains visible on the annotation pin in the timeline.
6. **No collapse for long threads.** All replies render. The popover grows as needed; reflow logic in `CommentPopover` already handles this.
7. **Per-reply ⋯ menu** lives at the right edge of each reply row, opacity 0 by default, opacity 1 on `:hover` or `:focus-within`. Only rendered for `isOwn && canEdit`.
8. **Edit-in-place.** Click ⋯ → Edit → the reply's body text replaces itself with a small inline textarea + Save/Cancel. Same pattern the parent already uses.
9. **Mobile carries automatically.** `CommentBottomSheet` already renders the same `ReplyThread` component — the flat layout works equally well in a vertically-scrollable sheet.

### What goes away

- `.reply-card` background, border, radius, padding (the card chrome)
- `.reply-thread-list`'s left-border rail and padding
- `.reply-thread-bar` (the expand chevron + count + "Reply" CTA row)
- The collapsed/expanded state machine in `ReplyThread` (`expanded`, `composing`)
- Lazy-load on expand, with its in-popover loading / error / retry chrome
- The `.reply-meta` author-only header on each reply (replaced by the avatar-bearing meta row)

### What stays

- All server contracts: `annotation-replies` routes, `AnnotationReply` type, reply reactions, notification fan-out
- Permissions: `canEdit` gates the composer pill and per-reply ⋯ menu
- Optimistic submit and draft-preservation on send failure (current behavior)
- Per-reply reactions, rendered with the existing `Reactions` component
- The reply-count badge on the marker pin (outside the popover, not in scope)
- All keyboard shortcuts: Cmd/Ctrl+Enter to submit, Esc to cancel (composer, edit, delete)

## Component shape

`ReplyThread` becomes a much simpler component:

- Props unchanged from today's signature.
- Internal state shrinks to: `draft`, `composerOpen`, `submitError`. No more `expanded`, no more `loading`, no more `loadError`/`fetchedForRef`.
- A `useEffect` on `annotationId` change triggers `onLoadReplies` immediately (replacing the expand-triggered load). The effect skips when `replies !== undefined`, same guard logic the current code uses.
- The component renders: optional hairline → list of `ReplyCard` rows → composer.

`ReplyCard` keeps its own state for edit mode and the overflow menu, but its DOM shrinks: the outer `.reply-card` wrapper drops its visual treatment (still useful as a layout container for the avatar + body flex row), and the meta row collapses into the body's first line.

`CommentPopover`'s `.cl-foot` footer simplifies. The combined "reactions on the left, reply controls on the right" arrangement breaks apart: reactions render directly under the body in their own row, then the thread (hairline + replies + composer) renders as a separate block below.

`CommentBottomSheet` requires no changes beyond inheriting the new `ReplyThread` rendering.

## CSS changes

This is the bulk of the visible work. New classes (replacing the deleted ones):

- `.cp-thread` — wrapper for the hairline + replies + composer block. `border-top: 1px solid var(--rule-2)` (the hairline, only rendered when `replies.length > 0`).
- `.cp-reply` — flex row: avatar column + body column. Gap matching the parent's avatar spacing.
- `.cp-reply-avatar` — 18×18, same color logic as the parent's `.cp-avatar`.
- `.cp-reply-meta` — author + relative timestamp inline, baseline-aligned, `--fs-xs` muted with author in `--ink`.
- `.cp-reply-body` — `--fs-md`, line-height 1.4, tight top margin.
- `.cp-reply-menu` — absolutely positioned at top-right of the reply row, `opacity: 0`, transitions to `1` on `.cp-reply:hover` or `.cp-reply:focus-within`.
- `.cp-composer` — flex row: current user's avatar + pill/textarea.
- `.cp-composer-pill` — collapsed state: pill-shaped input with placeholder text and `cursor: text`.
- `.cp-composer-open` — expanded state: small bordered box (using `--accent` for the active border) wrapping a borderless textarea + Cancel/Reply actions.

Deleted: `.reply-thread`, `.reply-thread-bar`, `.reply-thread-list`, `.reply-card`, `.reply-meta`, `.reply-expand`, `.reply-cta`, `.reply-thread-loading`, `.reply-thread-error`, `.reply-thread-retry`. The `.cl-foot` rules in CommentPopover collapse: reactions become a normal sibling of `.cp-body`, not a flex partner of the reply controls.

## Behavior details

**Eager-load consequence.** Today, opening a popover without expanding replies costs one annotations fetch. The new design adds one `GET /api/annotations/:id/replies` per open. For threads with zero replies, the route returns `{ replies: [] }` cheaply; the cost is mainly the round-trip. This is an acceptable trade for never showing a loading spinner inside the popover.

**Composer focus on open.** The composer pill does not auto-focus the textarea when the popover opens. It only expands on explicit click — opening a popover to read a comment shouldn't pull keyboard focus into a reply input.

**Failure handling.** If `onCreateReply` rejects, the composer stays open with the draft preserved and shows the existing error UI ("Couldn't send reply — try again."). Same for `onEditReply` failures inside a reply's edit-in-place state.

**Avatar on the composer.** A new `selfDisplayName` and `selfColor` flow into `ReplyThread` (alongside the existing `selfUserId`) so the pill's avatar matches the rest of the app's user-color treatment. These come from the same source `CommentPopover` already uses to color the parent annotation's avatar — the caller computes them once and threads them through.

**Reply-row avatars.** Each `ReplyCard` derives its avatar color from the reply's `user_id` using the existing `userColorMap` (the same `Map<string, string>` `AnnotationMarkers` and `Minimap` already consume) with `colorForAnnotationAuthor` as the fallback for user IDs not in the map. Today's `.reply-card` does not render an avatar at all; this is new. The map is threaded down from the same caller that already supplies it to other components.

**Empty-state placeholder.** The pill's placeholder text is just `"Reply…"`. No "Be the first to reply" hand-holding — the visual emptiness is the affordance.

**`replies === undefined` window.** Between popover open and the first reply load resolving, the thread block renders the hairline (if `replyCount > 0`) and nothing else. No spinner. Replies pop in when they arrive; if the fetch errors silently the user can close + reopen to retry. (This is a step back from the current explicit retry button, but eager-load makes the error rate visible enough through the parent comment's overall fetch flow that we don't need a dedicated retry chip.)

## Out of scope

- Threading replies-to-replies. The current model is a flat reply list and stays that way.
- Long-thread collapse. Confirmed not needed; popover handles tall content.
- Annotation pin marker changes. Reply-count badges on pins are unchanged.
- Mobile-specific layout (the bottom sheet inherits via the shared component).
- Reaction picker UX. Out of scope; existing `Reactions` component continues to render the same.

## Testing

Update `ReplyThread.test.tsx` and `ReplyCard.test.tsx` to match the new component shape. The key behaviors to cover (new or changed):

- Replies fetch automatically when the component mounts with `replies === undefined`, not on expand.
- Composer pill renders as a clickable element when `canEdit`; clicking expands to the textarea with autofocus.
- Cmd/Ctrl+Enter submits from the expanded composer.
- Esc collapses the expanded composer and clears the draft.
- Submit failure leaves the composer open with the draft preserved and shows the error message.
- Hairline renders iff `replies.length > 0`.
- ⋯ menu on a reply row is hidden by default and revealed on hover/focus (the test asserts the menu trigger is present in the DOM; visual hover state is CSS-only).
- Edit-in-place flow: ⋯ → Edit → textarea with the reply's body prefilled → Save commits, Cancel restores.

Add a Playwright journey (or extend the existing comment-thread journey) covering: open popover → see existing replies → click composer pill → type reply → Cmd+Enter to send → new reply appears at the bottom.
