# Presence Avatar Popovers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking a presence avatar opens a popover that identifies the viewer (name + state). Clicking the `+N` overflow chip opens a popover listing the non-visible viewers.

**Architecture:** No new transport. Server adds one field (`emailLocal`) to the presence row so the client can fall back to email-local when `displayName` is empty. Two new pure helpers (`formatPresenceState`, `positionPopover`) and one new component (`<PresencePopover />`) rendered via React portal. `PresenceAvatars` gains local state for which trigger is open. Same popover code path on desktop and mobile.

**Tech Stack:** React 19, vitest + happy-dom, `lucide-react` (already in use), `react-dom`'s `createPortal`.

**Spec:** [docs/superpowers/specs/2026-05-17-presence-popover-design.md](../specs/2026-05-17-presence-popover-design.md)

---

## File Structure

**Server**
- Modify: `src/server/presence-ws.ts` — add `emailLocal: string | null` to the row payload; thread it through `ConnCtx` and `addOrUpdate`.
- Modify: `src/server/presence.ts` — extend `PresenceRow` and the `addOrUpdate` `Input` to carry `emailLocal`.
- Modify: `src/server/presence.test.ts` — extend the existing fixtures to include the new field.
- Modify: `src/server/presence-ws.test.ts` — assert `emailLocal` is present on member rows and not on anonymous ones.

**Client**
- Modify: `src/client/lib/presence-client.ts` — add `emailLocal: string | null` to `PresenceRowDto`.
- Create: `src/client/lib/presence-format.ts` — pure helpers: `formatPresenceState`, `positionPopover`, `resolveDisplayName`.
- Create: `src/client/lib/presence-format.test.ts` — unit tests for each helper.
- Create: `src/client/components/PresencePopover.tsx` — popover component (portal, escape, outside-click, focus).
- Create: `src/client/components/PresencePopover.test.tsx` — render + interaction tests.
- Modify: `src/client/components/PresenceAvatars.tsx` — buttons + open-popover state + popover rendering.
- Modify: `src/client/components/PresenceAvatars.test.tsx` — extend the existing 7 tests with popover open/close/keyboard cases.
- Modify: `src/client/styles/app.css` — `.presence-popover-*` rules.

---

## Task 1: Server — `emailLocal` on presence rows

**Files:**
- Modify: `src/server/presence.ts`
- Modify: `src/server/presence.test.ts`
- Modify: `src/server/presence-ws.ts`
- Modify: `src/server/presence-ws.test.ts`

- [ ] **Step 1: Extend the failing test for the registry**

Append to `src/server/presence.test.ts`:

```typescript
describe('presence registry — emailLocal', () => {
  it('stores and returns emailLocal on the row', () => {
    const reg = createRegistry({ now: () => 1000 });
    reg.addOrUpdate('conn-1', 'proj-A', {
      userId: 'u-1',
      displayName: '',
      emailLocal: 'alice',
      state: 'active',
      isAnonymous: false,
    });
    const snap = reg.snapshot('proj-A');
    expect(snap.rows[0].emailLocal).toBe('alice');
  });

  it('accepts null emailLocal for anonymous rows', () => {
    const reg = createRegistry({ now: () => 1000 });
    reg.addOrUpdate('conn-1', 'proj-A', {
      userId: null,
      displayName: '',
      emailLocal: null,
      state: 'active',
      isAnonymous: true,
    });
    const snap = reg.snapshot('proj-A');
    expect(snap.anonymousCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to confirm failure**

Run: `npx vitest run src/server/presence.test.ts`
Expected: FAIL — `emailLocal` missing from the `Input` type or row.

- [ ] **Step 3: Add `emailLocal` to the registry types**

In `src/server/presence.ts`, extend `PresenceRow`:

```typescript
export type PresenceRow = {
  connId: string;
  userId: string | null;
  displayName: string;
  emailLocal: string | null;
  state: 'active' | 'idle';
  lastBeatAt: number;
  isAnonymous: boolean;
};
```

(`Input = Omit<PresenceRow, 'connId' | 'lastBeatAt'>` already; no change needed there.)

- [ ] **Step 4: Run tests to confirm green**

Run: `npx vitest run src/server/presence.test.ts`
Expected: PASS — all registry tests including the two new ones.

- [ ] **Step 5: Thread `emailLocal` through the WS handler**

In `src/server/presence-ws.ts`:

1. Extend `ConnCtx`:

```typescript
type ConnCtx = {
  connId: string;
  userId: string | null;
  displayName: string;
  emailLocal: string | null;
  isAnonymous: boolean;
  subscribed: Set<string>;
};
```

2. In the upgrade handler, compute `emailLocal` from the user:

```typescript
const ctx: ConnCtx = {
  connId: crypto.randomUUID(),
  userId: user?.id ?? null,
  displayName: user?.display_name ?? '',
  emailLocal: user?.email ? user.email.split('@')[0]! : null,
  isAnonymous: !user,
  subscribed: new Set(),
};
```

3. Pass it to `addOrUpdate` in the `beat` branch:

```typescript
registry.addOrUpdate(ctx.connId, projectId, {
  userId: ctx.userId,
  displayName: ctx.displayName,
  emailLocal: ctx.emailLocal,
  state,
  isAnonymous: ctx.isAnonymous,
});
```

4. Include it in the outbound payload — extend `stripInternal`:

```typescript
function stripInternal(row: {
  connId: string;
  userId: string | null;
  displayName: string;
  emailLocal: string | null;
  state: 'active' | 'idle';
  lastBeatAt: number;
}) {
  return {
    userId: row.userId,
    displayName: row.displayName,
    emailLocal: row.emailLocal,
    state: row.state,
    lastBeatAt: row.lastBeatAt,
  };
}
```

- [ ] **Step 6: Add a failing WS-integration test for `emailLocal` on broadcast**

In `src/server/presence-ws.test.ts`, inside the `describe('/ws/presence', ...)`, append:

```typescript
it('includes emailLocal on member rows broadcast to peers', async () => {
  const alice = seedUserAndSession('alice');
  const bob = seedUserAndSession('bob');
  const { projectId } = seedBandWithProject([alice.userId, bob.userId]);

  const wsA = await openWs(alice.cookieHeader);
  const wsB = await openWs(bob.cookieHeader);
  wsA.send(JSON.stringify({ type: 'subscribe', projectIds: [projectId] }));
  wsB.send(JSON.stringify({ type: 'subscribe', projectIds: [projectId] }));
  await nextMessage(wsA);
  await nextMessage(wsB);

  wsA.send(JSON.stringify({ type: 'beat', projectId, state: 'active' }));
  const onB = await nextMessage(wsB);
  const aliceRow = onB.rows.find((r: any) => r.displayName === 'alice');
  expect(aliceRow).toBeDefined();
  expect(aliceRow.emailLocal).toBe('alice');

  await closeWs(wsA);
  await closeWs(wsB);
});
```

(Recall `seedUserAndSession('alice')` registers the user as `alice@example.com` — the local-part is `alice`.)

- [ ] **Step 7: Run all tests**

Run: `npx vitest run`
Expected: PASS — full suite green (1142 tests).

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add src/server/presence.ts src/server/presence.test.ts src/server/presence-ws.ts src/server/presence-ws.test.ts
git commit -m "feat(presence): include emailLocal on presence rows"
```

---

## Task 2: Client type — extend `PresenceRowDto`

**Files:**
- Modify: `src/client/lib/presence-client.ts`

- [ ] **Step 1: Add `emailLocal` to the DTO**

In `src/client/lib/presence-client.ts`, find the `PresenceRowDto` type:

```typescript
export type PresenceRowDto = {
  userId: string | null;
  displayName: string;
  state: State;
  lastBeatAt: number;
};
```

Replace with:

```typescript
export type PresenceRowDto = {
  userId: string | null;
  displayName: string;
  emailLocal: string | null;
  state: State;
  lastBeatAt: number;
};
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. (Existing component code does not destructure `emailLocal` yet; it'll just be an extra field on the type, which is fine.)

- [ ] **Step 3: Run tests**

Run: `npx vitest run`
Expected: PASS — full suite green.

If `PresenceAvatars.test.tsx` fixtures fail because `emailLocal` is now required, add `emailLocal: null` to each fixture object inline.

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/presence-client.ts src/client/components/PresenceAvatars.test.tsx
git commit -m "feat(presence): add emailLocal to client PresenceRowDto"
```

---

## Task 3: `presence-format.ts` — `formatPresenceState` + `resolveDisplayName`

**Files:**
- Create: `src/client/lib/presence-format.ts`
- Create: `src/client/lib/presence-format.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/client/lib/presence-format.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { formatPresenceState, resolveDisplayName } from './presence-format';
import type { PresenceRowDto } from './presence-client';

function row(overrides: Partial<PresenceRowDto> = {}): PresenceRowDto {
  return {
    userId: 'u-1',
    displayName: 'Alice',
    emailLocal: 'alice',
    state: 'active',
    lastBeatAt: 0,
    ...overrides,
  };
}

describe('formatPresenceState', () => {
  it('returns "Active now" for an active row', () => {
    expect(formatPresenceState(row({ state: 'active' }), 10_000)).toBe('Active now');
  });

  it('returns "Idle just now" for an idle row within the last minute', () => {
    expect(formatPresenceState(row({ state: 'idle', lastBeatAt: 9_500 }), 10_000)).toBe('Idle just now');
  });

  it('returns "Idle X minutes ago" for an idle row 1-59 minutes old', () => {
    // 3 minutes ago.
    expect(formatPresenceState(row({ state: 'idle', lastBeatAt: 10_000 - 3 * 60_000 }), 10_000)).toBe('Idle 3 minutes ago');
    // Singular at exactly 1 minute.
    expect(formatPresenceState(row({ state: 'idle', lastBeatAt: 10_000 - 60_000 }), 10_000)).toBe('Idle 1 minute ago');
  });

  it('returns "Idle X hours ago" for an idle row >=60 minutes old', () => {
    // 2 hours ago.
    expect(formatPresenceState(row({ state: 'idle', lastBeatAt: 10_000 - 2 * 60 * 60_000 }), 10_000)).toBe('Idle 2 hours ago');
    // Singular at exactly 1 hour.
    expect(formatPresenceState(row({ state: 'idle', lastBeatAt: 10_000 - 60 * 60_000 }), 10_000)).toBe('Idle 1 hour ago');
  });
});

describe('resolveDisplayName', () => {
  it('returns displayName when present and non-empty', () => {
    expect(resolveDisplayName(row({ displayName: 'Alice', emailLocal: 'a' }))).toBe('Alice');
  });

  it('falls back to emailLocal when displayName is empty', () => {
    expect(resolveDisplayName(row({ displayName: '', emailLocal: 'alice' }))).toBe('alice');
  });

  it('falls back to emailLocal when displayName is whitespace', () => {
    expect(resolveDisplayName(row({ displayName: '   ', emailLocal: 'alice' }))).toBe('alice');
  });

  it('returns "Unknown" when both displayName and emailLocal are missing', () => {
    expect(resolveDisplayName(row({ displayName: '', emailLocal: null }))).toBe('Unknown');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/client/lib/presence-format.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the helpers**

Create `src/client/lib/presence-format.ts`:

```typescript
import type { PresenceRowDto } from './presence-client';

export function resolveDisplayName(row: PresenceRowDto): string {
  if (row.displayName.trim()) return row.displayName.trim();
  if (row.emailLocal && row.emailLocal.trim()) return row.emailLocal.trim();
  return 'Unknown';
}

export function formatPresenceState(row: PresenceRowDto, now: number): string {
  if (row.state === 'active') return 'Active now';
  const deltaMs = Math.max(0, now - row.lastBeatAt);
  const deltaMin = Math.floor(deltaMs / 60_000);
  if (deltaMin < 1) return 'Idle just now';
  if (deltaMin < 60) {
    return `Idle ${deltaMin} ${deltaMin === 1 ? 'minute' : 'minutes'} ago`;
  }
  const deltaHr = Math.floor(deltaMin / 60);
  return `Idle ${deltaHr} ${deltaHr === 1 ? 'hour' : 'hours'} ago`;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/client/lib/presence-format.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/presence-format.ts src/client/lib/presence-format.test.ts
git commit -m "feat(presence): formatPresenceState + resolveDisplayName helpers"
```

---

## Task 4: `presence-format.ts` — `positionPopover`

**Files:**
- Modify: `src/client/lib/presence-format.ts`
- Modify: `src/client/lib/presence-format.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `src/client/lib/presence-format.test.ts`:

```typescript
import { positionPopover } from './presence-format';

const VIEWPORT = { width: 1000, height: 800 };

describe('positionPopover', () => {
  it('anchors below and left-aligned with the trigger by default', () => {
    const trigger = { left: 100, top: 50, right: 124, bottom: 74 } as DOMRect;
    const popover = { width: 200, height: 120 };
    const pos = positionPopover(trigger, popover, VIEWPORT);
    expect(pos).toEqual({ top: 74 + 8, left: 100 });
  });

  it('shifts left when the popover would clip the right edge', () => {
    // Trigger near the right side: a 200-wide popover at left=900 would end at
    // 1100, past the 1000-wide viewport. Shift so right edge sits at 992.
    const trigger = { left: 900, top: 50, right: 924, bottom: 74 } as DOMRect;
    const popover = { width: 200, height: 120 };
    const pos = positionPopover(trigger, popover, VIEWPORT);
    expect(pos.left).toBe(1000 - 200 - 8);
    expect(pos.top).toBe(74 + 8);
  });

  it('flips above when the popover would clip the bottom edge', () => {
    const trigger = { left: 100, top: 760, right: 124, bottom: 784 } as DOMRect;
    const popover = { width: 200, height: 120 };
    const pos = positionPopover(trigger, popover, VIEWPORT);
    // Anchored above: trigger.top - popover.height - 8 = 760 - 120 - 8 = 632.
    expect(pos.top).toBe(632);
    expect(pos.left).toBe(100);
  });

  it('handles both right-clip and bottom-clip at once', () => {
    const trigger = { left: 900, top: 760, right: 924, bottom: 784 } as DOMRect;
    const popover = { width: 200, height: 120 };
    const pos = positionPopover(trigger, popover, VIEWPORT);
    expect(pos.left).toBe(1000 - 200 - 8);
    expect(pos.top).toBe(632);
  });

  it('clamps left to 8px if the trigger is near the left edge', () => {
    // Trigger off-screen-left for some reason; popover should still sit at left=8.
    const trigger = { left: -50, top: 50, right: -26, bottom: 74 } as DOMRect;
    const popover = { width: 200, height: 120 };
    const pos = positionPopover(trigger, popover, VIEWPORT);
    expect(pos.left).toBe(8);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/client/lib/presence-format.test.ts`
Expected: FAIL — `positionPopover` missing.

- [ ] **Step 3: Implement `positionPopover`**

Append to `src/client/lib/presence-format.ts`:

```typescript
type Rect = Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>;

export function positionPopover(
  trigger: Rect,
  popover: { width: number; height: number },
  viewport: { width: number; height: number },
): { top: number; left: number } {
  const MARGIN = 8;
  // Default: 8px below the trigger, left-aligned.
  let top = trigger.bottom + MARGIN;
  let left = trigger.left;

  // Right-edge clip: shift left so the right edge sits MARGIN inside the viewport.
  if (left + popover.width > viewport.width - MARGIN) {
    left = viewport.width - popover.width - MARGIN;
  }

  // Left clamp.
  if (left < MARGIN) left = MARGIN;

  // Bottom-edge clip: flip above the trigger.
  if (top + popover.height > viewport.height - MARGIN) {
    top = trigger.top - popover.height - MARGIN;
  }

  return { top, left };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/client/lib/presence-format.test.ts`
Expected: PASS — 13 tests total.

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/presence-format.ts src/client/lib/presence-format.test.ts
git commit -m "feat(presence): positionPopover helper for viewport-aware placement"
```

---

## Task 5: `<PresencePopover />` component

**Files:**
- Create: `src/client/components/PresencePopover.tsx`
- Create: `src/client/components/PresencePopover.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/client/components/PresencePopover.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PresencePopover } from './PresencePopover';
import type { PresenceRowDto } from '../lib/presence-client';

const TRIGGER_RECT = { left: 100, top: 50, right: 124, bottom: 74 } as DOMRect;

function row(overrides: Partial<PresenceRowDto> = {}): PresenceRowDto {
  return {
    userId: 'u-1',
    displayName: 'Alice',
    emailLocal: 'alice',
    state: 'active',
    lastBeatAt: Date.now(),
    ...overrides,
  };
}

describe('<PresencePopover /> single mode', () => {
  it('renders the name and active state', () => {
    render(<PresencePopover mode="single" rows={[row()]} triggerRect={TRIGGER_RECT} onClose={() => {}} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Active now')).toBeInTheDocument();
  });

  it('falls back to emailLocal when displayName is empty', () => {
    render(
      <PresencePopover
        mode="single"
        rows={[row({ displayName: '', emailLocal: 'bob' })]}
        triggerRect={TRIGGER_RECT}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('bob')).toBeInTheDocument();
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(<PresencePopover mode="single" rows={[row()]} triggerRect={TRIGGER_RECT} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when clicking outside the popover', () => {
    const onClose = vi.fn();
    render(
      <div>
        <div data-testid="outside">outside</div>
        <PresencePopover mode="single" rows={[row()]} triggerRect={TRIGGER_RECT} onClose={onClose} />
      </div>,
    );
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT close when clicking inside the popover', () => {
    const onClose = vi.fn();
    render(<PresencePopover mode="single" rows={[row()]} triggerRect={TRIGGER_RECT} onClose={onClose} />);
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('<PresencePopover /> list mode', () => {
  it('renders one row per viewer with name + state', () => {
    const rows = [
      row({ userId: 'u-1', displayName: 'Alice', state: 'active', lastBeatAt: Date.now() }),
      row({ userId: 'u-2', displayName: '', emailLocal: 'bob', state: 'idle', lastBeatAt: Date.now() - 5 * 60_000 }),
    ];
    render(<PresencePopover mode="list" rows={rows} triggerRect={TRIGGER_RECT} onClose={() => {}} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Active now')).toBeInTheDocument();
    expect(screen.getByText('bob')).toBeInTheDocument();
    expect(screen.getByText('Idle 5 minutes ago')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/client/components/PresencePopover.test.tsx`
Expected: FAIL — component missing.

- [ ] **Step 3: Implement `PresencePopover`**

Create `src/client/components/PresencePopover.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { paletteIndexForUserId, ANNOTATION_PALETTE } from '../lib/colors';
import { formatPresenceState, positionPopover, resolveDisplayName } from '../lib/presence-format';
import type { PresenceRowDto } from '../lib/presence-client';

type Props = {
  mode: 'single' | 'list';
  rows: PresenceRowDto[];
  triggerRect: DOMRect;
  onClose: () => void;
};

const POPOVER_WIDTH = 220;
// Heuristic — actual height depends on row count; the helper just needs a
// reasonable upper bound to decide flip-above. List mode grows; we cap at a
// rough estimate to keep positioning predictable on long lists.
function estimateHeight(mode: 'single' | 'list', rowCount: number): number {
  if (mode === 'single') return 96;
  // 40px header + ~44px per row, capped at ~6 rows visible (the popover
  // becomes scrollable beyond that).
  return Math.min(40 + Math.min(rowCount, 6) * 44, 320);
}

function colorFor(userId: string | null): string {
  if (!userId) return '#6a6a6a';
  return ANNOTATION_PALETTE[paletteIndexForUserId(userId, ANNOTATION_PALETTE.length)];
}

function initial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed[0]!.toUpperCase() : '?';
}

export function PresencePopover({ mode, rows, triggerRect, onClose }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const now = Date.now();

  // Compute position once on mount based on triggerRect + estimated popover size.
  const viewport = {
    width: typeof window !== 'undefined' ? window.innerWidth : 1024,
    height: typeof window !== 'undefined' ? window.innerHeight : 768,
  };
  const pos = positionPopover(triggerRect, { width: POPOVER_WIDTH, height: estimateHeight(mode, rows.length) }, viewport);

  // Escape closes.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Click outside closes. Uses mousedown so it fires before the next click
  // event lands on whatever the user clicked.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (wrapperRef.current.contains(e.target as Node)) return;
      onClose();
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  // Move focus to the popover on mount, restore to trigger on unmount.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    wrapperRef.current?.focus();
    return () => { previouslyFocused?.focus?.(); };
  }, []);

  const label = mode === 'single' ? `${resolveDisplayName(rows[0]!)} presence details` : 'All viewers';

  const body = mode === 'single'
    ? <SinglePopoverBody row={rows[0]!} now={now} />
    : <ListPopoverBody rows={rows} now={now} />;

  return createPortal(
    <div
      ref={wrapperRef}
      className="presence-popover"
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: POPOVER_WIDTH }}
    >
      {body}
    </div>,
    document.body,
  );
}

function SinglePopoverBody({ row, now }: { row: PresenceRowDto; now: number }) {
  const bg = colorFor(row.userId);
  const name = resolveDisplayName(row);
  return (
    <div className="presence-popover-body presence-popover-single">
      <div
        className="presence-popover-avatar"
        style={{ background: bg }}
        aria-hidden="true"
      >
        {initial(name)}
      </div>
      <div className="presence-popover-name">{name}</div>
      <div className="presence-popover-state">{formatPresenceState(row, now)}</div>
    </div>
  );
}

function ListPopoverBody({ rows, now }: { rows: PresenceRowDto[]; now: number }) {
  return (
    <ul className="presence-popover-body presence-popover-list">
      {rows.map((row) => {
        const bg = colorFor(row.userId);
        const name = resolveDisplayName(row);
        return (
          <li key={row.userId ?? row.lastBeatAt} className="presence-popover-list-row">
            <span className="presence-popover-list-avatar" style={{ background: bg }} aria-hidden="true">
              {initial(name)}
            </span>
            <span className="presence-popover-list-name">{name}</span>
            <span className="presence-popover-list-state">{formatPresenceState(row, now)}</span>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/client/components/PresencePopover.test.tsx`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/client/components/PresencePopover.tsx src/client/components/PresencePopover.test.tsx
git commit -m "feat(presence): PresencePopover component with portal + escape + outside-click"
```

---

## Task 6: Wire popover into `<PresenceAvatars />`

**Files:**
- Modify: `src/client/components/PresenceAvatars.tsx`
- Modify: `src/client/components/PresenceAvatars.test.tsx`

- [ ] **Step 1: Append failing tests for the new interactions**

Append to `src/client/components/PresenceAvatars.test.tsx`:

```typescript
import { fireEvent } from '@testing-library/react';

describe('<PresenceAvatars /> popover interactions', () => {
  it('clicking an avatar opens a popover with the viewer name', () => {
    usePresenceMock.mockReturnValue(snap([
      { userId: 'u1', displayName: 'Alice', emailLocal: 'alice', state: 'active', lastBeatAt: Date.now() },
    ]));
    render(<PresenceAvatars projectId="proj-A" />);
    fireEvent.click(screen.getByTestId('presence-avatar'));
    // The popover renders into document.body via portal; query globally.
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', expect.stringContaining('Alice'));
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('clicking the same avatar twice closes the popover', () => {
    usePresenceMock.mockReturnValue(snap([
      { userId: 'u1', displayName: 'Alice', emailLocal: 'alice', state: 'active', lastBeatAt: Date.now() },
    ]));
    render(<PresenceAvatars projectId="proj-A" />);
    const av = screen.getByTestId('presence-avatar');
    fireEvent.click(av);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(av);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('clicking a different avatar switches the open popover', () => {
    usePresenceMock.mockReturnValue(snap([
      { userId: 'u1', displayName: 'Alice', emailLocal: 'alice', state: 'active', lastBeatAt: Date.now() },
      { userId: 'u2', displayName: 'Bob',   emailLocal: 'bob',   state: 'active', lastBeatAt: Date.now() },
    ]));
    render(<PresenceAvatars projectId="proj-A" />);
    const [a, b] = screen.getAllByTestId('presence-avatar');
    fireEvent.click(a!);
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toMatch(/Alice/);
    fireEvent.click(b!);
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toMatch(/Bob/);
  });

  it('clicking the +N chip opens a list popover with the non-visible viewers', () => {
    const now = Date.now();
    usePresenceMock.mockReturnValue(snap([
      { userId: 'u1', displayName: 'A', emailLocal: 'a', state: 'active', lastBeatAt: now },
      { userId: 'u2', displayName: 'B', emailLocal: 'b', state: 'active', lastBeatAt: now - 1 },
      { userId: 'u3', displayName: 'C', emailLocal: 'c', state: 'active', lastBeatAt: now - 2 },
      { userId: 'u4', displayName: 'D', emailLocal: 'd', state: 'active', lastBeatAt: now - 3 },
      { userId: 'u5', displayName: 'E', emailLocal: 'e', state: 'active', lastBeatAt: now - 4 },
    ]));
    render(<PresenceAvatars projectId="proj-A" />);
    fireEvent.click(screen.getByTestId('presence-overflow'));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-label', 'All viewers');
    // First 3 (A, B, C) are visible avatars; the list should contain D and E only.
    expect(screen.getAllByText('D').length).toBeGreaterThan(0);
    expect(screen.getAllByText('E').length).toBeGreaterThan(0);
    expect(screen.queryByText('A')).toBeNull();
  });

  it('Escape closes the popover', () => {
    usePresenceMock.mockReturnValue(snap([
      { userId: 'u1', displayName: 'Alice', emailLocal: 'alice', state: 'active', lastBeatAt: Date.now() },
    ]));
    render(<PresenceAvatars projectId="proj-A" />);
    fireEvent.click(screen.getByTestId('presence-avatar'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
```

Also update the existing test fixtures to include `emailLocal: <something>` on every row — the type now requires it. Use `null` if you don't care about the value.

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run src/client/components/PresenceAvatars.test.tsx`
Expected: FAIL — the new 5 tests fail because avatars aren't buttons yet.

- [ ] **Step 3: Rewrite `PresenceAvatars.tsx` to use buttons + popover state**

Replace `src/client/components/PresenceAvatars.tsx` entirely with:

```tsx
import { useRef, useState } from 'react';
import { Eye } from 'lucide-react';
import { usePresence } from '../hooks/usePresence';
import { paletteIndexForUserId, ANNOTATION_PALETTE } from '../lib/colors';
import { resolveDisplayName } from '../lib/presence-format';
import { PresencePopover } from './PresencePopover';
import type { PresenceRowDto } from '../lib/presence-client';

type Props = { projectId: string };

const MAX_AVATARS = 3;

function colorFor(userId: string | null): string {
  if (!userId) return '#6a6a6a';
  return ANNOTATION_PALETTE[paletteIndexForUserId(userId, ANNOTATION_PALETTE.length)];
}

function initial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed[0]!.toUpperCase() : '?';
}

function dedupeByUserId(rows: PresenceRowDto[]): PresenceRowDto[] {
  const byUser = new Map<string, PresenceRowDto>();
  const anon: PresenceRowDto[] = [];
  for (const row of rows) {
    if (row.userId == null) { anon.push(row); continue; }
    const existing = byUser.get(row.userId);
    if (!existing) { byUser.set(row.userId, row); continue; }
    const existingActive = existing.state === 'active';
    const incomingActive = row.state === 'active';
    if (incomingActive && !existingActive) { byUser.set(row.userId, row); continue; }
    if (incomingActive === existingActive && row.lastBeatAt > existing.lastBeatAt) {
      byUser.set(row.userId, row);
    }
  }
  return [...byUser.values(), ...anon];
}

function order(rows: PresenceRowDto[]): PresenceRowDto[] {
  const deduped = dedupeByUserId(rows);
  const active = deduped.filter((r) => r.state === 'active').sort((a, b) => b.lastBeatAt - a.lastBeatAt);
  const idle = deduped.filter((r) => r.state === 'idle').sort((a, b) => b.lastBeatAt - a.lastBeatAt);
  return [...active, ...idle];
}

type OpenState =
  | { kind: 'avatar'; userId: string }
  | { kind: 'overflow' }
  | null;

export function PresenceAvatars({ projectId }: Props) {
  const map = usePresence([projectId]);
  const snap = map[projectId] ?? { rows: [], anonymousCount: 0 };
  const [open, setOpen] = useState<OpenState>(null);
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>());

  if (snap.rows.length === 0 && snap.anonymousCount === 0) return null;

  const ordered = order(snap.rows);
  const visible = ordered.slice(0, MAX_AVATARS);
  const hidden = ordered.slice(MAX_AVATARS);
  const overflow = hidden.length;
  const totalPeople = ordered.length + snap.anonymousCount;

  function setRef(key: string) {
    return (el: HTMLButtonElement | null) => {
      if (el) triggerRefs.current.set(key, el);
      else triggerRefs.current.delete(key);
    };
  }

  function toggleAvatar(userId: string) {
    setOpen((prev) =>
      prev && prev.kind === 'avatar' && prev.userId === userId ? null : { kind: 'avatar', userId },
    );
  }

  function toggleOverflow() {
    setOpen((prev) => (prev && prev.kind === 'overflow' ? null : { kind: 'overflow' }));
  }

  let popoverElement: React.ReactNode = null;
  if (open?.kind === 'avatar') {
    const row = visible.find((r) => r.userId === open.userId);
    const trigger = triggerRefs.current.get(`avatar:${open.userId}`);
    if (row && trigger) {
      popoverElement = (
        <PresencePopover
          mode="single"
          rows={[row]}
          triggerRect={trigger.getBoundingClientRect()}
          onClose={() => setOpen(null)}
        />
      );
    }
  } else if (open?.kind === 'overflow') {
    const trigger = triggerRefs.current.get('overflow');
    if (trigger) {
      popoverElement = (
        <PresencePopover
          mode="list"
          rows={hidden}
          triggerRect={trigger.getBoundingClientRect()}
          onClose={() => setOpen(null)}
        />
      );
    }
  }

  return (
    <>
      <div className="presence-avatars" role="group" aria-label={`${totalPeople} people viewing`}>
        {visible.map((row) => {
          const bg = colorFor(row.userId);
          const idle = row.state === 'idle';
          const userId = row.userId ?? `anon:${row.lastBeatAt}`;
          const isOpen = open?.kind === 'avatar' && open.userId === userId;
          const name = resolveDisplayName(row);
          return (
            <button
              type="button"
              key={userId}
              ref={setRef(`avatar:${userId}`)}
              data-testid="presence-avatar"
              className={'presence-avatar' + (idle ? ' presence-avatar-idle' : '')}
              style={{ background: bg, boxShadow: idle ? 'none' : `0 0 0 2px ${bg}` }}
              aria-label={`${name}, ${idle ? 'idle' : 'active'}`}
              aria-haspopup="dialog"
              aria-expanded={isOpen}
              title={`${name} — ${idle ? 'idle' : 'active'}`}
              onClick={() => toggleAvatar(userId)}
            >
              {initial(name)}
            </button>
          );
        })}
        {overflow > 0 && (
          <button
            type="button"
            ref={setRef('overflow')}
            className="presence-overflow"
            data-testid="presence-overflow"
            aria-haspopup="dialog"
            aria-expanded={open?.kind === 'overflow'}
            aria-label={`${overflow} more viewers`}
            onClick={toggleOverflow}
          >
            +{overflow}
          </button>
        )}
        {snap.anonymousCount > 0 && (
          <div
            className="presence-anon"
            data-testid="presence-anon"
            aria-label={`${snap.anonymousCount} anonymous viewers`}
            title={`${snap.anonymousCount} anonymous viewers`}
          >
            <Eye size={12} strokeWidth={2} aria-hidden="true" />
            <span>{snap.anonymousCount}</span>
          </div>
        )}
      </div>
      {popoverElement}
    </>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/client/components/PresenceAvatars.test.tsx`
Expected: PASS — original 7 tests + 5 new = 12 tests.

If the original "renders nothing when..." or initial-letter tests broke because of the button reset styles, fix them by either:
- Adjusting the test to query the button (still has `data-testid="presence-avatar"`), or
- Adjusting the CSS so `<button class="presence-avatar">` looks identical to the old `<div>` (covered in Task 7).

- [ ] **Step 5: Run full suite**

Run: `npx vitest run`
Expected: PASS — full suite green.

- [ ] **Step 6: Commit**

```bash
git add src/client/components/PresenceAvatars.tsx src/client/components/PresenceAvatars.test.tsx
git commit -m "feat(presence): wire popover into avatar + overflow buttons"
```

---

## Task 7: CSS for popover

**Files:**
- Modify: `src/client/styles/app.css`

- [ ] **Step 1: Append CSS**

Append to `src/client/styles/app.css`:

```css
/* Presence avatar buttons — reset native button styling so they still look
   like circular avatars (the elements changed from div to button in Task 6). */
button.presence-avatar,
button.presence-overflow {
  border: 0;
  cursor: pointer;
  font: inherit;
  padding: 0;
}
button.presence-avatar:focus-visible,
button.presence-overflow:focus-visible {
  outline: 2px solid var(--accent, #c17446);
  outline-offset: 2px;
}

/* Popover (rendered into document.body via portal). */
.presence-popover {
  background: var(--surface, #fff);
  color: var(--text, #222);
  border: 1px solid var(--border, #ddd);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  z-index: 1000;
  outline: none;
}
.presence-popover-body {
  padding: 12px;
}

/* Single-viewer body — stacked, centered. */
.presence-popover-single {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.presence-popover-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 16px;
  font-weight: 600;
}
.presence-popover-name {
  font-weight: 600;
  font-size: 13px;
}
.presence-popover-state {
  font-size: 12px;
  color: var(--text-secondary, #666);
}

/* List body — one row per non-visible viewer. */
.presence-popover-list {
  list-style: none;
  margin: 0;
  padding: 8px 0;
  max-height: 320px;
  overflow-y: auto;
}
.presence-popover-list-row {
  display: grid;
  grid-template-columns: 24px 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
}
.presence-popover-list-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
}
.presence-popover-list-name {
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.presence-popover-list-state {
  font-size: 11px;
  color: var(--text-secondary, #666);
}
```

- [ ] **Step 2: Typecheck + tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean, all green.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/client/styles/app.css
git commit -m "feat(presence): styles for popover (portal-rendered, focus rings)"
```

---

## Task 8: Manual verification + ship

**Files:** none (verification only).

- [ ] **Step 1: Run dev locally**

```bash
npm run dev
```

Open the printed UI URL. Sign in (the dev-auto-login should kick in). Open any project that has at least one stem.

- [ ] **Step 2: Visual checks**

- Solo: open the project alone. With current behavior you should see your own avatar in the header. Click it — the popover should appear directly under the avatar showing your display name (or email-local fallback) and "Active now".
- Two users: in a second incognito window, sign in as a different band member (use `npm run add-user` or hit `/api/auth/dev-login?email=foo@paperstem.local` directly per Task 13 of the previous plan). Open the same project. Each window should see the other's avatar. Click should open the popover.
- Idle: hide one tab for ~70s; the other view's avatar should desaturate; click should now show "Idle 1 minute ago" (or whatever the elapsed time is).
- Overflow: not testable solo unless you have 5+ concurrent tabs in the same project (different browsers / incognito count separately on the WS side). Skip if unavailable; the unit tests cover the rendering.
- Edges: scroll the project picker so a project row sits near the bottom of the viewport. Click its avatar. The popover should flip ABOVE the avatar instead of clipping below.

- [ ] **Step 3: Push and PR**

```bash
git push -u origin feat/presence-popover
gh pr create --title "feat(presence): click avatar to see who's viewing" --body "$(cat <<'EOF'
## Summary

- Click a presence avatar to open a popover identifying the viewer (name + state).
- Click +N to see the non-visible viewers in a list popover.
- Server adds emailLocal so the client can fall back gracefully when display_name is empty.
- One popover implementation works on desktop and mobile (viewport-aware positioning, flips above the trigger when near the bottom edge).

Spec: docs/superpowers/specs/2026-05-17-presence-popover-design.md

## Test plan
- [x] Unit suite green
- [ ] Click avatar in dev, popover shows correct name + state
- [ ] Click +N (if 4+ viewers) shows the non-visible ones
- [ ] Press Escape closes popover
- [ ] Click outside closes popover
- [ ] Popover near bottom of viewport flips above

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Wait for CI green BEFORE enabling auto-merge**

```bash
gh pr checks <pr-number> --watch --fail-fast
```

Only after all required checks report `pass`:

```bash
gh pr merge <pr-number> --auto --squash --delete-branch
```

(Per the project's CI policy — do NOT enable auto-merge before remote CI confirms green on the pushed SHA.)

- [ ] **Step 5: After deploy, re-probe**

```bash
curl -s https://paperstem-dev.fly.dev/api/version
```

Confirm the deployed SHA matches the merge commit. Open the dev URL in a browser and click a presence avatar — popover should appear.

---

## Notes for the implementor

- The presence row's `emailLocal` field is meant for display fallback only — do NOT expose the full email to the client, by design. Members shouldn't see each other's email addresses through the WS broadcast.
- `PresencePopover` uses `createPortal` because the picker row has `overflow-x` clipping that would otherwise hide the popover. Don't try to move it back inline.
- The `triggerRect` is captured at click time (via `getBoundingClientRect()`). It does NOT live-update on scroll — the popover stays where it was anchored. If the user scrolls while a popover is open, it may detach visually; click-outside still works to dismiss. That's acceptable for v1.
