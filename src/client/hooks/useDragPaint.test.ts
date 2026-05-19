import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useDragPaint, type PaintKind } from './useDragPaint';
import type { MouseEvent as ReactMouseEvent } from 'react';

type Row = { idx: number; el: HTMLElement };

interface World {
  rows: Row[];
  // hit-test target: which idx is at this (x, y), or null
  hitAt: (x: number, y: number) => number | null;
}

function setupWorld(idxs: number[]): World {
  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.top = '0';
  container.style.left = '0';
  document.body.appendChild(container);

  const rows: Row[] = idxs.map((idx) => {
    const el = document.createElement('div');
    el.setAttribute('data-track-idx', String(idx));
    container.appendChild(el);
    return { idx, el };
  });

  const elementFromPointSpy = vi.spyOn(document, 'elementFromPoint');
  let lastHit: number | null = null;
  elementFromPointSpy.mockImplementation(() => {
    const idx = lastHit;
    if (idx === null) return null;
    return rows.find((r) => r.idx === idx)?.el ?? null;
  });

  return {
    rows,
    hitAt: (_x, _y) => lastHit,
    // small helper attached for tests
    ...({
      __setHit: (idx: number | null) => {
        lastHit = idx;
      },
    } as object),
  } as World & { __setHit: (idx: number | null) => void };
}

function teardownWorld() {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
}

function fakeReactMouseDown(button = 0): ReactMouseEvent {
  return {
    button,
    preventDefault: vi.fn(),
  } as unknown as ReactMouseEvent;
}

function dispatchDocMouseMove(clientX = 50, clientY = 50) {
  const ev = new MouseEvent('mousemove', { clientX, clientY, bubbles: true });
  document.dispatchEvent(ev);
}

function dispatchDocMouseUp() {
  const ev = new MouseEvent('mouseup', { bubbles: true });
  document.dispatchEvent(ev);
}

interface PaintArgs {
  state: Map<string, boolean>;
}

function makeHooks(args: PaintArgs) {
  const apply = vi.fn((idx: number, kind: PaintKind, target: boolean) => {
    args.state.set(`${idx}:${kind}`, target);
  });
  const readState = vi.fn(
    (idx: number, kind: PaintKind) => args.state.get(`${idx}:${kind}`) ?? false,
  );
  return { apply, readState };
}

describe('useDragPaint', () => {
  beforeEach(() => {
    document.body.className = '';
  });
  afterEach(() => {
    teardownWorld();
    // Defensive cleanup in case a test left listeners or body class behind.
    document.body.className = '';
  });

  it('calls apply on the origin row with the opposite of its current state on mousedown', () => {
    const args = { state: new Map<string, boolean>() };
    const { apply, readState } = makeHooks(args);
    const { result } = renderHook(() => useDragPaint({ apply, readState }));

    setupWorld([0, 1, 2]);
    act(() => {
      result.current.onPillMouseDown(0, 'mute', fakeReactMouseDown());
    });

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(0, 'mute', true);
    expect(args.state.get('0:mute')).toBe(true);

    act(() => dispatchDocMouseUp());
  });

  it('paints subsequent rows with the brush target as the cursor crosses them', () => {
    const args = { state: new Map<string, boolean>() };
    const { apply, readState } = makeHooks(args);
    const { result } = renderHook(() => useDragPaint({ apply, readState }));

    const world = setupWorld([0, 1, 2]) as ReturnType<typeof setupWorld> & {
      __setHit: (idx: number | null) => void;
    };

    act(() => {
      result.current.onPillMouseDown(0, 'mute', fakeReactMouseDown());
    });

    act(() => {
      world.__setHit(1);
      dispatchDocMouseMove();
    });
    expect(apply).toHaveBeenCalledWith(1, 'mute', true);

    act(() => {
      world.__setHit(2);
      dispatchDocMouseMove();
    });
    expect(apply).toHaveBeenCalledWith(2, 'mute', true);

    act(() => dispatchDocMouseUp());
  });

  it('does not re-apply to a row already painted in this gesture', () => {
    const args = { state: new Map<string, boolean>() };
    const { apply, readState } = makeHooks(args);
    const { result } = renderHook(() => useDragPaint({ apply, readState }));

    const world = setupWorld([0, 1]) as ReturnType<typeof setupWorld> & {
      __setHit: (idx: number | null) => void;
    };

    act(() => {
      result.current.onPillMouseDown(0, 'mute', fakeReactMouseDown());
    });

    act(() => {
      world.__setHit(1);
      dispatchDocMouseMove();
    });
    act(() => {
      world.__setHit(0);
      dispatchDocMouseMove();
    });
    act(() => {
      world.__setHit(1);
      dispatchDocMouseMove();
    });

    // Origin (idx 0) painted once on mousedown; idx 1 painted once on first cross.
    expect(apply).toHaveBeenCalledTimes(2);
    expect(args.state.get('0:mute')).toBe(true);
    expect(args.state.get('1:mute')).toBe(true);

    act(() => dispatchDocMouseUp());
  });

  it('skips rows whose state already matches the brush target', () => {
    const args = {
      state: new Map<string, boolean>([
        // idx 1 is already muted; brush is "mute = true", so it should be skipped.
        ['1:mute', true],
      ]),
    };
    const { apply, readState } = makeHooks(args);
    const { result } = renderHook(() => useDragPaint({ apply, readState }));

    const world = setupWorld([0, 1]) as ReturnType<typeof setupWorld> & {
      __setHit: (idx: number | null) => void;
    };

    act(() => {
      result.current.onPillMouseDown(0, 'mute', fakeReactMouseDown());
    });
    act(() => {
      world.__setHit(1);
      dispatchDocMouseMove();
    });

    // apply called only for the origin row (idx 0).
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(0, 'mute', true);

    act(() => dispatchDocMouseUp());
  });

  it('locks the brush kind to the origin pill regardless of which pill the cursor crosses', () => {
    const args = { state: new Map<string, boolean>() };
    const { apply, readState } = makeHooks(args);
    const { result } = renderHook(() => useDragPaint({ apply, readState }));

    const world = setupWorld([0, 1]) as ReturnType<typeof setupWorld> & {
      __setHit: (idx: number | null) => void;
    };

    // Start gesture on the M pill (kind = 'mute').
    act(() => {
      result.current.onPillMouseDown(0, 'mute', fakeReactMouseDown());
    });

    // Cursor enters track row 1. Even if it's hovering over the S pill area,
    // the brush stays 'mute'.
    act(() => {
      world.__setHit(1);
      dispatchDocMouseMove();
    });

    expect(apply).toHaveBeenCalledWith(1, 'mute', true);
    expect(args.state.get('1:solo')).toBeUndefined();

    act(() => dispatchDocMouseUp());
  });

  it('tears down listeners on mouseup so subsequent moves do not paint', () => {
    const args = { state: new Map<string, boolean>() };
    const { apply, readState } = makeHooks(args);
    const { result } = renderHook(() => useDragPaint({ apply, readState }));

    const world = setupWorld([0, 1, 2]) as ReturnType<typeof setupWorld> & {
      __setHit: (idx: number | null) => void;
    };

    act(() => {
      result.current.onPillMouseDown(0, 'mute', fakeReactMouseDown());
    });
    act(() => dispatchDocMouseUp());

    apply.mockClear();
    act(() => {
      world.__setHit(2);
      dispatchDocMouseMove();
    });
    expect(apply).not.toHaveBeenCalled();
  });

  it('toggles the dragging-vertical body class on for the gesture and off on mouseup', () => {
    const args = { state: new Map<string, boolean>() };
    const { apply, readState } = makeHooks(args);
    const { result } = renderHook(() => useDragPaint({ apply, readState }));

    setupWorld([0]);

    expect(document.body.classList.contains('dragging-vertical')).toBe(false);
    act(() => {
      result.current.onPillMouseDown(0, 'mute', fakeReactMouseDown());
    });
    expect(document.body.classList.contains('dragging-vertical')).toBe(true);
    act(() => dispatchDocMouseUp());
    expect(document.body.classList.contains('dragging-vertical')).toBe(false);
  });

  it('ignores non-left-button mousedowns', () => {
    const args = { state: new Map<string, boolean>() };
    const { apply, readState } = makeHooks(args);
    const { result } = renderHook(() => useDragPaint({ apply, readState }));

    setupWorld([0, 1]);
    act(() => {
      result.current.onPillMouseDown(0, 'mute', fakeReactMouseDown(2));
    });
    expect(apply).not.toHaveBeenCalled();
    expect(document.body.classList.contains('dragging-vertical')).toBe(false);
  });

  it('does not paint when the cursor is over no data-track-idx ancestor', () => {
    const args = { state: new Map<string, boolean>() };
    const { apply, readState } = makeHooks(args);
    const { result } = renderHook(() => useDragPaint({ apply, readState }));

    const world = setupWorld([0, 1]) as ReturnType<typeof setupWorld> & {
      __setHit: (idx: number | null) => void;
    };

    act(() => {
      result.current.onPillMouseDown(0, 'mute', fakeReactMouseDown());
    });
    apply.mockClear();

    act(() => {
      world.__setHit(null);
      dispatchDocMouseMove();
    });
    expect(apply).not.toHaveBeenCalled();

    act(() => dispatchDocMouseUp());
  });

  it('starting a new gesture after the first commits cleanly', () => {
    const args = { state: new Map<string, boolean>() };
    const { apply, readState } = makeHooks(args);
    const { result } = renderHook(() => useDragPaint({ apply, readState }));

    const world = setupWorld([0, 1, 2]) as ReturnType<typeof setupWorld> & {
      __setHit: (idx: number | null) => void;
    };

    // First gesture mutes 0 and 1.
    act(() => {
      result.current.onPillMouseDown(0, 'mute', fakeReactMouseDown());
    });
    act(() => {
      world.__setHit(1);
      dispatchDocMouseMove();
    });
    act(() => dispatchDocMouseUp());

    // Second gesture starts on the (now muted) idx 0 → brush is "unmute",
    // and should unmute idx 1 too.
    apply.mockClear();
    act(() => {
      result.current.onPillMouseDown(0, 'mute', fakeReactMouseDown());
    });
    expect(apply).toHaveBeenCalledWith(0, 'mute', false);
    act(() => {
      world.__setHit(1);
      dispatchDocMouseMove();
    });
    expect(apply).toHaveBeenCalledWith(1, 'mute', false);
    act(() => dispatchDocMouseUp());
  });
});
