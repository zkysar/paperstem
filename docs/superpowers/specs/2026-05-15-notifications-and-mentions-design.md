# Notifications, @mentions, and unread state — Design

**Status:** Approved, ready for implementation plan.
**Date:** 2026-05-15

## Goal

Close the loop on comments. Today a bandmate's comment is invisible until someone reopens the project. Add:

1. Email notifications for new comments, replies in threads you've participated in, and @mentions of you.
2. `@`-mentions of band members (autocomplete from the roster), surfaced via in-app counter and immediate email.
3. In-app unread state: project-list dot for "new comments since last viewed," per-comment "new" treatment on the ruler, and a header mentions bell.
4. Per-user preferences with sensible defaults and per-band mute.
5. Reply-by-email — a user can reply to a Paperstem email from their inbox and the reply lands as a thread reply on the original comment.

Notifications are **not** sent for: reactions on someone else's comment, new project uploads, renames. Reactions on **your own** comment DO notify you (single-author signal).

## Scope summary

| Trigger event | Recipients | Email | In-app |
|---|---|---|---|
| Top-level comment on project | Band members (minus author), respecting prefs | Batched digest (or daily / off) | Project-list dot + per-comment "new" |
| Reply in a thread | Original commenter + prior repliers (minus current author) | Batched digest (or daily / off) — split pref `email_thread_activity` | Project-list dot + per-comment "new" |
| @mention of user | The mentioned user | Immediate (or off) | Header bell + per-mention `read_at` |
| Reaction on your own comment | Comment author only | Batched digest (or off) | Project-list dot (no per-comment "new" — the comment itself isn't new) |

## Data model

Five new tables added to [src/server/schema.sql](../../../src/server/schema.sql). All `CREATE TABLE IF NOT EXISTS`. No backfill: defaults applied at read time when prefs row is absent; per-project read rows materialize on first project open.

```sql
CREATE TABLE mentions (
  id              TEXT PRIMARY KEY,
  source_type     TEXT NOT NULL CHECK (source_type IN ('annotation','reply')),
  source_id       TEXT NOT NULL,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      INTEGER NOT NULL,
  read_at         INTEGER
);
CREATE INDEX idx_mentions_target_unread
  ON mentions(target_user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX idx_mentions_source ON mentions(source_type, source_id);

CREATE TABLE project_reads (
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  last_read_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, project_id)
);

CREATE TABLE notification_prefs (
  user_id                 TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email_mentions          INTEGER NOT NULL DEFAULT 1,
  email_project_activity  TEXT NOT NULL DEFAULT 'batched'
    CHECK (email_project_activity IN ('batched','daily','off')),
  email_thread_activity   TEXT NOT NULL DEFAULT 'batched'
    CHECK (email_thread_activity IN ('batched','daily','off')),
  digest_hour_local       INTEGER NOT NULL DEFAULT 8,
  timezone                TEXT NOT NULL DEFAULT 'UTC',
  updated_at              INTEGER NOT NULL
);

CREATE TABLE band_mutes (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  band_id    TEXT NOT NULL REFERENCES bands(id) ON DELETE CASCADE,
  muted_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, band_id)
);

CREATE TABLE pending_notifications (
  id              TEXT PRIMARY KEY,
  recipient_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('comment','reply','mention','reaction')),
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_type     TEXT NOT NULL CHECK (source_type IN ('annotation','reply')),
  source_id       TEXT NOT NULL,
  author_user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  preview         TEXT NOT NULL,
  reply_token     TEXT,
  created_at      INTEGER NOT NULL,
  sent_at         INTEGER,
  send_attempts   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_pending_notifications_unsent
  ON pending_notifications(recipient_id, created_at) WHERE sent_at IS NULL;
```

**Mention token format.** Mentions stored verbatim in `annotations.body` / `annotation_replies.body` as `@[<uid>]`. No `@everyone` — autocomplete shows the band roster only. Tokens are resolved to display names at render time using the already-loaded band roster. Tokens for users no longer in the band render in a **muted color** (distinct CSS class, not the active-mention chip styling — visually marks them as a former member without labeling them as such).

**Reply tokens.** `pending_notifications.reply_token` is a per-row opaque string included in the `Reply-To` address of the outgoing email (see Reply-by-email).

## Triggers and recipient computation

In a new server module `notifications.ts`, `recordActivity(tx, { sourceType, sourceId, projectId, authorId, body, kind })` is called from inside the existing transactional insert handlers in [src/server/annotations.ts](../../../src/server/annotations.ts), [src/server/annotation-replies.ts](../../../src/server/annotation-replies.ts), and [src/server/annotation-reactions.ts](../../../src/server/annotation-reactions.ts) (the reaction case fires only for reactions whose target's author is not the reactor).

Steps inside `recordActivity`:

1. **Parse mentions** from `body` (where applicable) using `@\[[a-z0-9]+\]`. Resolve each token: must be a current band member; drop silently otherwise. Insert one `mentions` row per resolved target.
2. **Compute the comment/reply/reaction recipient set:**
   - `comment` kind: all band members except author.
   - `reply` kind: original annotation author + every prior replier on this annotation, excluding current author.
   - `reaction` kind: just the author of the target comment/reply (if different from the reactor).
3. **Apply prefs filter:** drop recipients whose relevant pref is `'off'`, or who have a `band_mutes` row for this band, or who are the author of the event itself. Pref selection: comment → `email_project_activity`; reply → `email_thread_activity`; reaction → `email_project_activity`; mention is its own pref (`email_mentions`).
4. **Mention-priority dedup:** if a recipient appears both in the mentions set and the comment/reply set for this event, only one `pending_notifications` row is inserted, with `kind = 'mention'`.
5. **Insert `pending_notifications` rows** with a `preview` snapshot (first 140 chars of body, mention tokens already resolved to names) and a freshly-generated `reply_token`.
6. **For `kind = 'mention'` rows only:** synchronously call `flushOne(rowId)` to send the email immediately. Failures here do not abort the parent transaction — failed mention rows simply stay unsent and the periodic flush retries.

`recordActivity` runs in the same transaction as the parent insert. A rollback removes the notification rows.

## Read path & API surface

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/notifications/unread` | `{ projectsWithUnread: [{ projectId, bandId, count }], unreadMentions: [{ id, projectId, projectName, authorName, preview, createdAt, sourceType, sourceId }] }` |
| POST | `/api/projects/:id/view-comments` | Bump `project_reads.last_read_at = now()`. Fires when the user views the comments panel (CommentsDrawer open, CommentList visible, or first comment scrolled into view) — NOT on project mount. |
| POST | `/api/mentions/:id/read` | Mark one mention read. |
| POST | `/api/mentions/read-all` | Mark all caller's mentions read. Client wraps in undo-toast. |
| GET | `/api/notification-prefs` | Return prefs, applying defaults if no row. |
| PUT | `/api/notification-prefs` | Update prefs. |
| POST | `/api/bands/:id/mute` / DELETE | Toggle per-band mute. |

Polling: client calls `GET /api/notifications/unread` every **25s when tab focused**, every **60s when backgrounded**, and immediately on `visibilitychange → visible`.

**Per-comment unread.** `GET /api/projects/:id/annotations` already returns each annotation's `created_at`. The client compares against the project's `last_read_at` (also exposed by `/api/notifications/unread` per project, or fetched per-project on load) and renders any annotation/reply with `created_at > last_read_at` with a "new" treatment on the ruler pin and in the comment list. The bumped server timestamp invalidates the local "new" state on next poll.

**Project-list dot — unread query.** `projectsWithUnread` for a user is the set of (band) projects where any of the following has `created_at > project_reads.last_read_at` (treating absence of a `project_reads` row as `last_read_at = 0`):

- An `annotations` row on the project.
- An `annotation_replies` row on any annotation in the project.
- An `annotation_reactions` or `annotation_reply_reactions` row on a comment/reply **authored by the user**, by a different user (so a reaction by you on your own comment doesn't make your own project show as unread).

Single SQL query with three LEFT JOIN existence subqueries, indexed appropriately.

## Client UI

**A. `MentionInput`** — shared component wrapping the comment + reply textarea. Plaintext underlying state with a positioned overlay rendering chips. Typing `@` opens a dropdown listing band members (filtered by typed substring). Arrow keys + Enter selects; selection replaces the `@<query>` text with `@[uid]` in state. Used in [CommentPopover](../../../src/client/components/CommentPopover.tsx) and [ReplyThread](../../../src/client/components/ReplyThread.tsx).

**B. `renderBody(body, roster)`** — helper splitting on `@[uid]` tokens into text + `<MentionChip>` elements. Used in [CommentList](../../../src/client/components/CommentList.tsx), [CommentPopover](../../../src/client/components/CommentPopover.tsx), [CommentBottomSheet](../../../src/client/components/CommentBottomSheet.tsx), [ReplyThread](../../../src/client/components/ReplyThread.tsx). Former members render with a `.mention-chip--ex-member` class (muted color).

**C. Per-project unread dot** in [ProjectPicker](../../../src/client/components/ProjectPicker.tsx) — dot shown when project id appears in `projectsWithUnread`. Source: new `useUnreadNotifications()` hook.

**D. Per-comment "new" treatment** — visible on:
- The ruler pin ([AnnotationMarkers](../../../src/client/components/AnnotationMarkers.tsx)): a small accent ring or dot on pins whose underlying annotation has `created_at > project.last_read_at`. Same for unread replies (apply to the parent pin if any descendant is new).
- The comment list ([CommentList](../../../src/client/components/CommentList.tsx)): a left-edge accent on the row.

**E. Mentions bell in [AppHeader](../../../src/client/components/AppHeader.tsx)** — button next to the avatar. Badge with unread count. Popover lists each unread mention (author, project, 140-char preview, relative time). Click → navigate to the comment; the mention is marked read only when the comment scrolls into view in the project (intersection observer), not on click. Footer "Mark all as read" → optimistic update + undo toast for 10s.

**F. Notification settings dialog** — opened from a new "Notification settings" item in the existing avatar-menu dropdown. Contains:
- Email when @mentioned (toggle)
- Email for activity on threads I'm in (Batched / Daily / Off)
- Email for new top-level comments and reactions on my comments (Batched / Daily / Off)
- Daily digest delivery time + timezone (hour-of-day picker + IANA timezone select; timezone defaults from `Intl.DateTimeFormat().resolvedOptions().timeZone` at first open)
- Per-band mute list (one row per band the user is in)

**G. View-comments instrumentation** — fire `POST /api/projects/:id/view-comments` when:
- The CommentsDrawer / CommentBottomSheet opens.
- An annotation is selected (popover opens).
- The CommentList becomes visible (intersection-observed).
- On `visibilitychange → visible` if any of the above is currently active.

Project mount alone does NOT clear unread.

## Email content

**Mention email (immediate).** Subject: `<Author> on "<Project>": <preview>` (truncated at 80 chars). Body: author + project header, full comment text with mentions resolved to names, "View comment" deep-link, footer with "Mute this band" / "Notification settings" permalinks.

**Batched digest (every 5 min).** Subject: `<Author> on "<Project>": <preview>` for single events; `<N> new comments on "<Project>"` for N events on one project; `Activity in <M> projects` for multi-project. Body groups by project; each event is `<Author>: <140-char preview>` linked to the deep-link.

**Daily digest.** Same body format. Subject prefix `[Paperstem] Daily summary —`. Flush job runs hourly and picks up `email_*_activity = 'daily'` recipients whose local clock matches their `digest_hour_local`.

**No-empty-digest guard.** Recipients with zero unsent rows produce no email.

**Reply-To.** Set to `replies+<reply_token>@<inbound-domain>` (see next section). For digest emails with multiple comments, each comment's link points to that comment's anchor; the Reply-To is set to one representative token (replies via that route inject as a reply to the most-recent comment in the digest — acceptable v1 compromise).

## Reply-by-email

Inbound provider: **Postmark Inbound** (or SendGrid Inbound Parse — choice is implementation-time but Postmark has simpler webhook semantics). Webhook receives POSTed JSON of the parsed email and delivers it to `POST /api/inbound/email`.

**Address scheme.** Outgoing emails set `Reply-To: replies+<reply_token>@<inbound-domain>`. The `<inbound-domain>` is a separate dedicated domain (e.g. `mail.paperstem.app`) MX'd to the inbound provider. `<reply_token>` is the `pending_notifications.reply_token` value (random 24+ chars).

**Inbound flow:**
1. Provider POSTs to `/api/inbound/email`. The endpoint verifies the provider's signature (HMAC shared secret).
2. Extract the `To` address, parse out `<reply_token>`. Look up the matching `pending_notifications` row to find the parent `source_type` / `source_id` / `recipient_id`.
3. Reject if no match or if the row is older than 30 days.
4. Verify the sender's email matches `users.email` for `recipient_id`. Reject otherwise (prevents reply spoofing).
5. Strip quoted text (use `email-reply-parser` or equivalent) — the leading non-quoted block is the new content.
6. Insert as an `annotation_replies` row on the same `annotation_id` (climbing from `annotation_replies` to its parent when the source was itself a reply). Author = `recipient_id`. Body = stripped content. This re-enters the normal `recordActivity` path, so further notifications fan out as usual.
7. Return 200 to the provider on success; 4xx on auth/parse failures; 5xx for transient errors (provider retries).

**Bounce handling.** Out of scope for v1. Provider bounce webhooks are not wired up — bounced emails just sit in the inbox and the user notices in the app.

**Operational notes.** New env vars: `INBOUND_PROVIDER`, `INBOUND_DOMAIN`, `INBOUND_WEBHOOK_SECRET`. Documented in [CLAUDE.md](../../../CLAUDE.md) update. Fly secrets added at deploy time.

## Preferences semantics

Pref selection logic in `applyPrefsFilter`:

- Mention recipient → `email_mentions = 0` → drop. `email_mentions = 1` → keep with kind=mention (immediate send).
- Comment recipient (band-wide top-level comment) → `email_project_activity`: `'off'` drop, `'batched'` keep for 5-min flush, `'daily'` keep for daily flush.
- Reply recipient (thread participant) → `email_thread_activity`, same three-way.
- Reaction recipient (your own comment) → `email_project_activity`, same three-way.
- Band mute → drop regardless of any pref (mention or otherwise).

Default for new users: mentions on, both activity prefs `'batched'`, `digest_hour_local=8`, `timezone` from browser.

## Migration & rollout

Five tables added with `CREATE TABLE IF NOT EXISTS`. No data backfill. Existing [schema-migration.test.ts](../../../src/server/schema-migration.test.ts) pattern extended to assert the migration runs on both empty and populated DBs without data loss.

**PR sequence** — each independently shippable. CLAUDE.md "review delegation by change size" applies to each.

1. **Schema + `recordActivity` + flush job + mention parser** (server only; no UI). Comments and replies start producing notification rows. Mentions don't fire yet because the UI can't emit tokens, but the server-side parser, queue, and email digests are live.
2. **Read endpoints + `useUnreadNotifications` hook + project-list unread dot + view-comments instrumentation + per-comment "new" treatment.** Project-level unread state visible end-to-end.
3. **`MentionInput` + `renderBody` + mention token rendering.** `@`-autocomplete lights up; mention emails start firing.
4. **Mentions bell + per-mention read endpoints + arrival-based mark-read.**
5. **Notification settings dialog + per-band mute + timezone-aware daily digest.**
6. **Reply-by-email**: inbound provider config, `/api/inbound/email`, reply-token plumbing in outgoing mail. Largest single PR, shipped last so the rest is proven first.

## Testing

Vitest, server + client projects, following [docs/testing.md](../../testing.md).

**Server unit / route tests:**
- `notifications.test.ts` — `parseMentions`, recipient computation per kind, prefs/mute filter, mention-priority dedup.
- `notifications-flush.test.ts` — batched flush, daily flush hour matching against `digest_hour_local + timezone`, no-empty-digest guard, 3-strike give-up, sent_at correctness.
- `notification-prefs.test.ts`, `band-mutes.test.ts`, `mentions.test.ts`, `notifications-unread.test.ts` — route tests.
- Extend `annotations.test.ts`, `annotation-replies.test.ts`, `annotation-reactions.test.ts` to assert `recordActivity` rows materialize in the same transaction and roll back on insert failure.
- `inbound-email.test.ts` — webhook signature verification, token lookup, sender match, quote stripping, reply insert, all rejection cases.

**Client unit tests:**
- `MentionInput.test.tsx`, `renderBody.test.tsx`, `useUnreadNotifications.test.tsx`, `MentionsBell.test.tsx`, `NotificationSettingsDialog.test.tsx`.
- Extend `CommentList.test.tsx`, `CommentPopover.test.tsx`, `CommentBottomSheet.test.tsx`, `AnnotationMarkers.test.tsx` for mention chips + "new" rendering.

**Integration:** extend `e2e-critical-path.test.ts` with: user A posts a comment mentioning user B → mention row exists → immediate email sent → B's `/api/notifications/unread` returns it → B opens project + scrolls comment into view → mention is marked read.

## Open risks / deferred

- **Push / mobile notifications** — deferred.
- **Real-time channel** (SSE or WebSocket) — 25s focused poll covers v1.
- **Notifications archive view** (`/mentions` page) — deferred; popover + scroll is enough.
- **Bounce/spam handling** for outbound mail — deferred; no provider beyond Gmail SMTP yet.
- **Accessibility** (keyboard nav for `@`-autocomplete, `aria-live` for badge updates, non-color affordance for unread) — explicitly out of scope for v1, matching the rest of the codebase.
- **Per-user inbound reply rate limit** — out of scope; revisit if abused.
- **Digest "smart" merging** (e.g. one digest per band rather than across bands) — current design groups by project only; multi-band recipients get one combined email. Revisit if it feels noisy.
