# Project presence indicators — design

Status: approved through brainstorming, ready for implementation planning.
Date: 2026-05-16.

## Goal

Show Google-Docs-style presence on each project: who currently has it open, and whether they are actively interacting with it or merely have it open in a backgrounded tab. Surface this in two places: the `ProjectPicker` row for each project, and the `AppHeader` while a project is open.

## Non-goals

- Live cursors, transport sync, or chat. Pure roster + active/idle only.
- Historical "last seen" data — presence is ephemeral.
- Horizontal scaling. Paperstem currently runs on a single Fly VM; multi-instance presence (Redis pub/sub, sticky routing) is explicitly out of scope and noted as a future requirement.
- Public-link viewer identification. Anonymous viewers are counted but never named.

## Architecture

One WebSocket per browser tab, mounted on the existing Hono server at `/ws/presence`. Hono's Node adapter (`@hono/node-ws`) supports WS upgrades, so no new server process or proxy config is required beyond verifying Fly's HTTP service passes WS upgrades (it does by default).

### Server-side registry (in-memory)

```ts
type PresenceRow = {
  connId: string;          // server-generated per WS connection
  userId: string | null;   // null for anonymous (public-link) viewers
  displayName: string;     // empty string for anonymous
  state: 'active' | 'idle';
  lastBeatAt: number;      // ms epoch
  isAnonymous: boolean;
};

type Registry = Map<string /* projectId */, Map<string /* connId */, PresenceRow>>;
```

The registry is in-memory only. If the VM restarts, clients heartbeat within 10s and rebuild the registry naturally. No SQLite writes, no migration.

### Wire protocol

Client → server:

- `{ "type": "subscribe", "projectIds": ["abc", "def"] }` — replaces the connection's subscription set. Server reply: a `presence` message for each authorized project.
- `{ "type": "beat", "projectId": "abc", "state": "active" }` — sent every 10s on a timer and immediately on state transition.

Server → client:

- `{ "type": "presence", "projectId": "abc", "rows": [...], "anonymousCount": 2 }` — full snapshot. Snapshots are small enough (typical: <10 rows) that we don't bother with deltas.

### Lifecycle

- **On upgrade:** validate the session cookie or the `?link=<token>` query param. Reject 401 if neither resolves. Assign a `connId`.
- **On subscribe:** filter requested `projectIds` to those the conn can access (membership row, or matching public link). Silently drop unauthorized IDs — do not signal which ones were rejected, to prevent enumeration.
- **On beat:** upsert the conn's `PresenceRow` in the named project's map and bump `lastBeatAt`. Broadcast snapshot to all conns subscribed to that project (subject to outbound filtering — see Security).
- **On disconnect:** remove every row owned by this `connId` across all projects, broadcast each affected project.
- **Sweeper:** `setInterval` every 10s scans all rows and removes any with `lastBeatAt < now - 30s`. Broadcasts each affected project once at the end of the sweep.

## Client active/idle detection

A module-level singleton `presenceClient` owns the WS connection per tab. It computes a current tab state:

- **Active** = `document.visibilityState === 'visible'` AND `now - lastInputAt < 60_000`.
- **Idle** = anything else.

Listeners installed once on `window`: `mousemove`, `keydown`, `pointerdown`, `visibilitychange`, `blur`, `focus`. Each input event updates `lastInputAt = Date.now()`. A `setInterval(10_000)` recomputes state and sends a `beat` for every subscribed `projectId`. On any state transition (active↔idle) it sends immediately rather than waiting for the next tick.

### Hooks

- `usePresenceConnection()` — mounted once in `App.tsx`. Opens the WS, owns reconnect logic, exposes the underlying state machine via a small context.
- `usePresence(projectIds: string[])` — components call this with the IDs they care about; the hook merges the IDs into the singleton's subscription set on mount, removes them on unmount, and returns a `Record<projectId, { rows, anonymousCount }>` keyed snapshot.

### Multi-tab dedup (display only)

The server keys rows by `connId`, so two tabs from the same user produce two rows. The display layer in `<PresenceAvatars />` dedupes by `userId`: same user appears once, with `state = 'active'` if any of their tabs is active. Anonymous viewers have no `userId`, so each anonymous tab counts separately — that's the most honest signal we have for public-link traffic.

### Reconnect

Exponential backoff with jitter, capped at 30s. On reconnect, the client re-sends `subscribe` with its current set and expects fresh snapshots in response.

## UI

A new component `<PresenceAvatars projectId={...} />` rendered in:

- **`ProjectPicker.tsx`** — right edge of each project row, after existing metadata.
- **`AppHeader.tsx`** — when a project is open, immediately left of the avatar dropdown.

### Visual spec

- Up to 3 circular avatars, 24px diameter, with the member's first initial. Background color derived from a hash of `userId`. Slight horizontal overlap (negative margin) for the stacked look. **Ordering**: all active members first (sorted by `lastBeatAt` descending), then idle members (also by `lastBeatAt` descending). The first 3 in that order render as avatars; the remainder fold into `+N`.
- **Active state**: full opacity, 2px ring matching the avatar background color (a slightly darker shade).
- **Idle state**: `filter: grayscale(1)`, opacity ~55%, no ring.
- If more than 3 members are present, render a trailing `+N` chip with neutral background. `N` counts members beyond the first 3, not anonymous viewers.
- Anonymous viewers: a single trailing chip showing an eye icon and the count (e.g. `👁 2`). Never expanded, never named.
- Tooltip on hover: `<name> — active` or `<name> — idle 2m ago`. Anonymous chip tooltip: `2 anonymous viewers`.
- Empty roster: render nothing. No "0 here" placeholder.

### Styling

Uses existing CSS-variable design tokens (per the typography refactor merged in PR #18). The only new tokens needed are for the ring color derivation — done inline from the hashed background color, not as named tokens.

### Accessibility

- Avatar group: `role="group"`, `aria-label="N people viewing"`.
- Each avatar: `aria-label="<name>, active"` or `"<name>, idle"`.
- Anonymous chip: `aria-label="N anonymous viewers"`.

## Security and authorization

- WS upgrade rejects 401 if no valid session cookie and no valid `?link=<token>`.
- `subscribe` filters to authorized project IDs only; unauthorized IDs are silently dropped (no error message that could leak existence).
- **Outbound filtering for anonymous conns:** anonymous (public-link) viewers receive no member-level presence data in v1. They get `{ rows: [], anonymousCount: N }` only, or are simply not broadcast to. Member conns receive the full `rows` plus `anonymousCount`. Members never see who anonymous viewers are.
- Broadcast scope is the set of conns subscribed to the specific `projectId`, not all connections.

## Testing

- **Server** — `src/server/presence.test.ts`: registry unit tests (add/remove/sweep, auth-on-subscribe drops unauthorized IDs silently, anonymous-conn outbound filter). One WS integration test that connects two fake conns to the same project and asserts each receives the other's presence and the disconnect removal.
- **Client hook** — `src/client/hooks/usePresence.test.ts`: vitest with fake timers + mock WS. Asserts state transitions, dedup-by-userId across multiple tabs, reconnect backoff, subscribe-set diffing on hook mount/unmount.
- **Component** — `src/client/components/PresenceAvatars.test.tsx`: renders members, idle-vs-active styling, overflow-chip math, anonymous chip, empty state, aria labels.
- **E2E** — `tests/e2e/presence.spec.ts`: two browser contexts open the same project; assert each sees the other's avatar appear, then sees it flip to idle when one tab is hidden via `page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))` or equivalent. Required per CLAUDE.md (cross-component flow with timing).

## Known limits

- **Single-VM only.** With multiple Fly instances, two users on different instances would not see each other. Sharding requires a pub/sub layer (Redis or similar). Documented for future work.
- **No persistence.** Restart wipes the registry; clients heartbeat back within 10s.
- **No "was here recently" memory.** Once a user closes the tab and the sweeper drops them, they vanish.
