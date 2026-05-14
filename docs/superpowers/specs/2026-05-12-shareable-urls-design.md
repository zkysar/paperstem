# Shareable URLs — Design

**Status:** Approved, ready for implementation plan.
**Date:** 2026-05-12

## Goal

Let a user share a link to a specific project at a specific moment, with all reproducible state encoded in the URL. The address bar stays minimal; full snapshots are produced on demand by a Share button.

## Behavior overview

Two URL forms, both **fragment-based** (`#...`). Fragment is never sent to the server, so no routing changes, no SPA fallback concerns.

### Live-sync URL (the address bar)

```
https://paperstem.app/#p=abc123
```

- Only `p=<projectId>` ever appears here.
- Updated via `history.replaceState` whenever `activeProjectId` changes — no back-history pollution.
- Empty fragment when no project is loaded.

### Share-snapshot URL (the Share button output)

```
https://paperstem.app/#p=abc123&t=42.50&l=10.00-30.00&le=0&fs=stem_xyz&fc=cmt_abc&mv=0.80&mix=stem_a:m,stem_b:s,stem_c:v0.50
```

- Built on-click from a full snapshot of player + UI state.
- Copied to clipboard.
- When opened, the app applies all fields, then resets the address bar back to just `#p=<id>`.

## Encoding format

`key=value&key=value` after `#`, URL-encoded. All keys optional except `p`. Keys at their default value are **omitted** entirely.

| Key | Type | Default (omit when) | Example |
|---|---|---|---|
| `p` | string | required | `p=abc123` |
| `t` | number, 2 decimals (centi-seconds) | `0` | `t=42.50` |
| `l` | `<start>-<end>` (2 decimals each) | no loop region | `l=10.00-30.00` |
| `le` | `1`/`0` (loop enabled) | `1` (only override when set and disabled) | `le=0` |
| `mv` | master volume, 2 decimals | `1.0` | `mv=0.80` |
| `fs` | stem server ID | no focused stem | `fs=stem_xyz` |
| `fc` | comment ID | no focused comment | `fc=cmt_abc` |
| `mix` | per-stem deviations | every stem at defaults | `mix=stem_a:m,stem_b:s,stem_c:v0.50` |

**`mix` grammar:**
- Comma-separated entries: `<stemId>:<modifier>(<modifier>...)`.
- Modifiers: `m` (muted), `s` (soloed), `v<n>` (volume, only when ≠ 1.0).
- Stems entirely at default (volume 1.0, not muted, not soloed) are omitted.

### Why this format

- Human-readable, debuggable by eye.
- Cheap to parse — `URLSearchParams` for the top level, simple split for `mix`.
- Forward-stable: unknown keys are ignored, so future additions (e.g. `pr` for playback rate) won't break old links/clients.
- Length stays small for the typical "here's a spot" link (just `p` and `t` → ~20 chars after `#`).
- "Share from the very start" produces a clean `#p=<id>` link — `t=0` is the default and gets omitted.

Waveform normalization is **not** included. It's a personal viewing preference, not part of the moment being shared; including it would override the recipient's chosen default for no benefit.

### Precision

Centi-second (`42.50`) timestamps. Finer than musical-aural targeting needs.

## Load flow

1. **On `PaperstemApp` mount** (after auth — not in `App`), parse `window.location.hash` once into a `ShareState | null`.
2. Strip the fragment from the address bar via `history.replaceState` immediately, so subsequent refreshes don't replay it.
3. Hold the parsed state in a ref (`pendingShareState`). If `p` is present, set `activeProjectId = p` — the existing project-load effect picks it up.
4. **After the project is fully loaded** (stems decoded, peaks ready), drain the ref by applying the rest in this order:
   1. `setLoop(start, end)`
   2. `setLoopEnabled(le)`
   3. Per-stem mix: `setVolume`, `toggleMute`, `toggleSolo` as needed
   4. `setMasterVolume(mv)`
   5. `focusStem(fs)`
   6. `setActiveCommentId(fc)` — and ensure the comment is **scrolled into view in the comments drawer** and **emphasized** (sustained highlight, not just selected). See "Arrival affordance" below.
   7. `seek(t)` — last
5. Player stays **paused**. No autoplay (browser autoplay policies + surprise audio).
6. Clear the ref after applying so subsequent project loads don't re-apply.

### Arrival affordance (recipient UX)

A share link that lands a recipient on a paused player at `0:42` with a custom mix is silent and confusing — they don't know the link "did" anything, and a `mix=...` that mutes most stems can read as "broken."

When `ShareState` is consumed (i.e. at least one non-`p` field applied), show a **dismissable arrival banner** anchored near the timeline/transport. Contents:

- "Shared at `0:42`" (or "Shared link applied" if no `t`)
- A "▶ Listen" call-to-action that starts playback from the linked moment (this also satisfies the autoplay-gesture requirement)
- A short note listing what was carried over, only when those fields are present: e.g. "Custom mix · Loop region · Focused comment"

Banner auto-dismisses on first play or any explicit user dismiss. Stays visible until then — no time-based fade — because the worst failure mode is the user not noticing it.

When `fc` is present, the focused comment must be:
- Scrolled into view in the comments drawer (open the drawer if closed)
- Highlighted with a sustained emphasis (not just the normal selection state) that fades over a few seconds — long enough to register

### Address-bar live-sync

A single effect: whenever `activeProjectId` flips to a non-null value, call `history.replaceState(null, '', '#p=<id>')`. When it goes back to `null`, clear the fragment.

### Login interaction

Fragment parsing happens on mount of `PaperstemApp`, which only renders after `useSession` resolves a logged-in user.

**Magic-link case:** if the user is logged out, the magic-link click navigates through `/auth/callback?token=...` which is a fresh server-side navigation and **drops the fragment**. To preserve it across this flow, `App` stashes the current `location.hash` in `sessionStorage` (`paperstem.pendingShareHash`) whenever it renders `LoginScreen` with a non-empty hash present. After login, on first `PaperstemApp` mount, parse `location.hash` first, then fall back to `sessionStorage.getItem('paperstem.pendingShareHash')` and consume/clear it. This means the share-link state survives even the magic-link round trip.

The magic-link login flow can take a minute or two; the user may forget why they clicked. When `LoginScreen` renders with `pendingShareHash` present (or `location.hash` non-empty), show a small hint above or below the email field: **"You'll be taken to the shared moment after you log in."** Keeps expectations anchored across the round trip.

**Already-logged-in case:** fragment is in `location.hash` at `PaperstemApp` mount. Trivial.

## UI entry points

### Primary: "Share" button in `AppToolbar`

- Visible only when a project is loaded.
- Click: snapshot current state → build URL → `navigator.clipboard.writeText` → button enters a "copied" state for ~2s, then resets.
- The "copied" state shows a small inline summary of what's included beyond the project + time, e.g. "Copied — includes loop, mix" or "Copied — includes mix" or just "Copied" if only `p + t`. Lists only the categories that are present (loop, mix, focused stem, focused comment). This calibrates the sender's expectation about what they just shipped — particularly important if they had absent-mindedly soloed a stem.
- If clipboard write fails (insecure context, denied permission): fall back to a small popover with the URL pre-selected for manual copy.

### Secondary: "Copy link to this comment" in the comment menu

- New item on each comment's existing action menu (in `CommentList.tsx` / `CommentPopover.tsx` — whichever already hosts the menu).
- Builds a URL with `p`, `fc=<commentId>`, and `t=<comment.startTime>`. Same copy flow.

### Not in v1

- Per-stem "share this solo" buttons. (The main Share button already captures solo state.)
- A "Share" modal with edit-before-copy. The snapshot approach matches the user's mental model.

## Files

### New

- **`src/client/lib/share-url.ts`** — pure encode/decode.
  - `type ShareState` — all fields optional except `projectId`.
  - `encodeShareUrl(state: ShareState): string` — fragment string, omits defaults.
  - `decodeShareUrl(fragment: string): ShareState | null` — returns `null` if no `p`.
  - `buildShareUrl(state: ShareState, baseUrl: string): string` — full URL.
  - `snapshotShareState(player, activeProjectId, activeCommentId, overrides?): ShareState` — used by both Share button and comment-menu item; `overrides` lets the comment menu force `focusedCommentId` and `time`.

- **`src/client/lib/share-url.test.ts`** — round-trip, default omission, malformed input, clamping.

- **`src/client/hooks/useShareLink.ts`** — ~30 LOC.
  - On mount: read `window.location.hash`, parse once, strip the hash. Return the parsed `ShareState | null`.
  - Returns a `syncProjectId(id: string | null)` callback that `replaceState`s `#p=<id>` or clears.

### Changed

- **`src/client/App.tsx`** — wire `useShareLink`. Hold parsed `ShareState` in a ref. New effect drains the ref after project load (gated on `player.state.stems.length > 0` and matching `projectId`). After draining, set an `arrivalState` (the categories applied + the timestamp) used by the banner. Effect on `activeProjectId` calls `syncProjectId`. Opens `CommentsDrawer` when `fc` is being applied.
- **`src/client/components/AppToolbar.tsx`** — Share button + copy logic + "copied — includes X" summary + clipboard fallback popover.
- **`src/client/auth/LoginScreen.tsx`** — show a "you'll be taken to the shared moment after you log in" hint when a pending share hash is present.
- **`src/client/components/CommentList.tsx`** (or `CommentPopover.tsx`) — "Copy link" menu item. Also: a sustained-emphasis style for the comment when it's the arrival focus (separate from normal active-comment selection).

### New

- **`src/client/components/ShareArrivalBanner.tsx`** — the recipient-side banner. Props: `{ time?: number, categories: Array<'mix' | 'loop' | 'stem' | 'comment'>, onPlay: () => void, onDismiss: () => void }`. Stateless. Rendered conditionally by `App.tsx`. Companion `ShareArrivalBanner.test.tsx` covers render variants.

### Not adding

- React Router. A single fragment key doesn't justify it. Revisit if path-based URLs ever become a requirement.
- Toast infrastructure. Inline label-flip on the button is enough.
- Context/provider. State is already centralized in `App.tsx`.

## Edge cases

| Case | Behavior |
|---|---|
| Fragment empty or malformed | No share-load. Picker opens as normal. |
| `p` missing | Whole fragment treated as no-op. |
| `p` references project user can't access / deleted | Existing `loadError` path. Fragment already stripped, refresh doesn't retry. |
| `t` past track duration | Clamped to `duration`. |
| `t < 0` or NaN | Omit (treat as 0). |
| Loop range invalid (`start ≥ end`, NaN, negative) | Drop loop entirely. |
| `fs` / `fc` ID not present after load | Silently skip that field. |
| `mix` references stems not in the project | Skip those entries; apply the rest. |
| `mix` mutes every stem in the project | Applied as-is; the arrival banner's "Custom mix" category + "▶ Listen" CTA makes it clear the silence is intentional. |
| `fc` comment exists but drawer is closed | Drawer opens; comment scrolls into view; sustained emphasis fades after ~3s. |
| Clipboard write fails | Show popover with pre-selected URL. |
| User opens share link while viewing a different project | Switch to the new project (same as picker click). |
| User opens share link while logged out | `App` stashes the hash in `sessionStorage` before rendering `LoginScreen`. After magic-link login, `PaperstemApp` mount falls back to that stash and consumes it. |
| Stem IDs change later (re-upload, migration) | Old `mix`/`fs` silently ignored. `p` and `t` still work. |

## Testing

### `share-url.test.ts`
- Round-trip: state → encode → decode → equal.
- Each field omitted when at default.
- Each field present when explicitly set.
- Malformed inputs return `null` (no `p`) or drop just the bad field.
- Time/loop clamping (if clamping lives in the decoder; otherwise covered by integration test).

### `useShareLink.test.ts`
- Reads hash on mount, returns parsed state once.
- Strips hash after reading.
- `syncProjectId(id)` writes `#p=<id>`; `syncProjectId(null)` clears.

### Integration
- One smoke test in `App.test.tsx`: mount with `#p=abc&t=10` set, assert `player.seek` called with `10` after load completes.

### Manual
- Generate share link from main toolbar, paste in new tab, verify state matches and arrival banner appears with correct category list.
- Generate from comment menu, verify lands at correct time, drawer opens, comment scrolls into view, sustained emphasis is visible.
- Generate a share link with every stem muted — verify arrival banner makes the silence intelligible (recipient understands why playback is silent).
- Verify "Copied" state on Share button lists the right categories (loop only, mix only, both, etc.).
- Refresh after navigating around — confirm address bar reflects only current project ID.
- Open a share link while logged out — confirm LoginScreen shows the "you'll be taken to the shared moment" hint. Complete magic-link login — confirm state still applies (sessionStorage path).

### Not needed
- Server-side tests. Fragment never reaches the server.
