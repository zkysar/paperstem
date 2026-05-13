import { renderHook } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { describe, it, expect, vi } from 'vitest';
import { useKeyboard } from './useKeyboard';

function stubPlayer() {
  return {
    state: {
      stems: [],
      duration: 0,
      loop: null,
      isPlaying: false,
      focusedIdx: 0,
    } as any,
    currentTime: 0,
    seek: vi.fn(),
    togglePlay: vi.fn(),
    toggleLoopEnabled: vi.fn(),
    setLoop: vi.fn(),
    clearLoop: vi.fn(),
    setLoopEnabled: vi.fn(),
    toggleMute: vi.fn(),
    toggleSolo: vi.fn(),
    setVolume: vi.fn(),
    setMasterVolume: vi.fn(),
    focusStem: vi.fn(),
    toggleWaveformNormalization: vi.fn(),
    load: vi.fn(),
  } as any;
}

function defaultViewport() {
  return {
    state: {
      hZoom: 1,
      trackHeight: 44,
      scrollLeft: 0,
      followMode: 'smooth' as const,
      followActive: true,
    },
    zoomH: vi.fn(),
    zoomHBy: vi.fn(),
    zoomV: vi.fn(),
    setScrollLeft: vi.fn(),
    fitToWindow: vi.fn(),
    setFollowActive: vi.fn(),
    setFollowMode: vi.fn(),
  } as any;
}

function defaultOpts() {
  return {
    player: stubPlayer(),
    pickerOpen: false,
    drawerOpen: false,
    popoverOpen: false,
    annotationCreateMode: false,
    viewport: defaultViewport(),
    onTogglePicker: vi.fn(),
    onClosePicker: vi.fn(),
    onCloseDrawer: vi.fn(),
    onClosePopover: vi.fn(),
    onCancelCreate: vi.fn(),
    onToggleShortcuts: vi.fn(),
  };
}

describe('useKeyboard cmd-K toggles picker', () => {
  it('cmd-K calls onTogglePicker', () => {
    const onTogglePicker = vi.fn();
    renderHook(() =>
      useKeyboard({
        ...defaultOpts(),
        onTogglePicker,
      }),
    );
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', metaKey: true }),
    );
    expect(onTogglePicker).toHaveBeenCalledOnce();
  });

  it('ctrl-K (Windows/Linux) also toggles', () => {
    const onTogglePicker = vi.fn();
    renderHook(() =>
      useKeyboard({
        ...defaultOpts(),
        onTogglePicker,
      }),
    );
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }),
    );
    expect(onTogglePicker).toHaveBeenCalledOnce();
  });
});

describe('useKeyboard Esc precedence', () => {
  it('closes picker first when picker is open', () => {
    const onClosePicker = vi.fn();
    const onCloseDrawer = vi.fn();
    const onClosePopover = vi.fn();
    const onCancelCreate = vi.fn();
    renderHook(() =>
      useKeyboard({
        ...defaultOpts(),
        pickerOpen: true,
        drawerOpen: true,
        popoverOpen: true,
        annotationCreateMode: true,
        onClosePicker,
        onCloseDrawer,
        onClosePopover,
        onCancelCreate,
      }),
    );
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClosePicker).toHaveBeenCalledOnce();
    expect(onClosePopover).not.toHaveBeenCalled();
    expect(onCloseDrawer).not.toHaveBeenCalled();
    expect(onCancelCreate).not.toHaveBeenCalled();
  });

  it('Escape closes popover before drawer', () => {
    const onClosePopover = vi.fn();
    const onCloseDrawer = vi.fn();
    renderHook(() =>
      useKeyboard({
        ...defaultOpts(),
        drawerOpen: true,
        popoverOpen: true,
        onClosePopover,
        onCloseDrawer,
      }),
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClosePopover).toHaveBeenCalledOnce();
    expect(onCloseDrawer).not.toHaveBeenCalled();
  });

  it('Escape closes drawer when drawerOpen is true', () => {
    const onCloseDrawer = vi.fn();
    renderHook(() =>
      useKeyboard({
        ...defaultOpts(),
        drawerOpen: true,
        onCloseDrawer,
      }),
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCloseDrawer).toHaveBeenCalledOnce();
  });

  it('cancels create-mode when picker closed and drawer not open', () => {
    const onCloseDrawer = vi.fn();
    const onCancelCreate = vi.fn();
    renderHook(() =>
      useKeyboard({
        ...defaultOpts(),
        drawerOpen: false,
        annotationCreateMode: true,
        onCloseDrawer,
        onCancelCreate,
      }),
    );
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onCancelCreate).toHaveBeenCalledOnce();
    expect(onCloseDrawer).not.toHaveBeenCalled();
  });
});

describe('useKeyboard zoom chords', () => {
  it('cmd-= calls viewport.zoomH("in")', () => {
    const viewport = defaultViewport();
    renderHook(() =>
      useKeyboard({
        ...defaultOpts(),
        viewport,
      }),
    );
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: '=', metaKey: true }),
    );
    expect(viewport.zoomH).toHaveBeenCalledWith('in', expect.any(Object));
  });

  it('cmd-minus calls viewport.zoomH("out")', () => {
    const viewport = defaultViewport();
    renderHook(() =>
      useKeyboard({
        ...defaultOpts(),
        viewport,
      }),
    );
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: '-', metaKey: true }),
    );
    expect(viewport.zoomH).toHaveBeenCalledWith('out', expect.any(Object));
  });

  it('shift-cmd-= calls viewport.zoomV("in")', () => {
    const viewport = defaultViewport();
    renderHook(() =>
      useKeyboard({
        ...defaultOpts(),
        viewport,
      }),
    );
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: '=', metaKey: true, shiftKey: true }),
    );
    expect(viewport.zoomV).toHaveBeenCalledWith('in');
  });

  it('shift-cmd-minus calls viewport.zoomV("out")', () => {
    const viewport = defaultViewport();
    renderHook(() =>
      useKeyboard({
        ...defaultOpts(),
        viewport,
      }),
    );
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: '-', metaKey: true, shiftKey: true }),
    );
    expect(viewport.zoomV).toHaveBeenCalledWith('out');
  });

  it('cmd-0 calls viewport.fitToWindow', () => {
    const viewport = defaultViewport();
    renderHook(() =>
      useKeyboard({
        ...defaultOpts(),
        viewport,
      }),
    );
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: '0', metaKey: true }),
    );
    expect(viewport.fitToWindow).toHaveBeenCalledOnce();
  });

  it('? opens shortcuts overlay', () => {
    const onToggleShortcuts = vi.fn();
    renderHook(() =>
      useKeyboard({
        ...defaultOpts(),
        onToggleShortcuts,
      }),
    );
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }));
    expect(onToggleShortcuts).toHaveBeenCalledOnce();
  });

  it('? does not fire when typing in an input', () => {
    const onToggleShortcuts = vi.fn();
    renderHook(() =>
      useKeyboard({
        ...defaultOpts(),
        onToggleShortcuts,
      }),
    );
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: '?', bubbles: true }),
    );
    expect(onToggleShortcuts).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });
});

describe('useKeyboard WASD pan/scroll', () => {
  function withViewport(): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'viewport';
    Object.defineProperty(el, 'clientWidth', { value: 600, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty(el, 'scrollWidth', { value: 1800, configurable: true });
    Object.defineProperty(el, 'scrollHeight', { value: 800, configurable: true });
    el.scrollLeft = 600;
    el.scrollTop = 200;
    document.body.appendChild(el);
    return el;
  }

  it('A pans the viewport left via viewport.setScrollLeft', () => {
    const viewport = defaultViewport();
    const el = withViewport();
    renderHook(() => useKeyboard({ ...defaultOpts(), viewport }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(viewport.setScrollLeft).toHaveBeenCalled();
    const call = viewport.setScrollLeft.mock.calls[0];
    expect(call[0]).toBe(600 - 100); // scrollLeft - step (600/6 = 100)
    document.body.removeChild(el);
  });

  it('D pans the viewport right', () => {
    const viewport = defaultViewport();
    const el = withViewport();
    renderHook(() => useKeyboard({ ...defaultOpts(), viewport }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));
    expect(viewport.setScrollLeft).toHaveBeenCalled();
    const call = viewport.setScrollLeft.mock.calls[0];
    expect(call[0]).toBe(600 + 100);
    document.body.removeChild(el);
  });

  it('W scrolls viewport up', () => {
    const viewport = defaultViewport();
    const el = withViewport();
    renderHook(() => useKeyboard({ ...defaultOpts(), viewport }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
    expect(el.scrollTop).toBe(200 - 100);
    document.body.removeChild(el);
  });

  it('S scrolls viewport down', () => {
    const viewport = defaultViewport();
    const el = withViewport();
    renderHook(() => useKeyboard({ ...defaultOpts(), viewport }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's' }));
    expect(el.scrollTop).toBe(200 + 100);
    document.body.removeChild(el);
  });

  it('A and D suspend auto-follow', () => {
    const viewport = defaultViewport();
    const el = withViewport();
    renderHook(() => useKeyboard({ ...defaultOpts(), viewport }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(viewport.setFollowActive).toHaveBeenCalledWith(false);
    document.body.removeChild(el);
  });

  it('WASD does not fire in text inputs', () => {
    const viewport = defaultViewport();
    const el = withViewport();
    renderHook(() => useKeyboard({ ...defaultOpts(), viewport }));
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(viewport.setScrollLeft).not.toHaveBeenCalled();
    document.body.removeChild(input);
    document.body.removeChild(el);
  });
});

describe('useKeyboard solo (O)', () => {
  it('O calls player.toggleSolo when a track is focused', () => {
    const player = stubPlayer();
    player.state.focusedIdx = 2;
    player.state.stems = [{}, {}, {}] as any;
    renderHook(() => useKeyboard({ ...defaultOpts(), player }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'o' }));
    expect(player.toggleSolo).toHaveBeenCalledWith(2);
  });
});
