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
    zoomVBy: vi.fn(),
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
    sectionCreateMode: false,
    viewport: defaultViewport(),
    onTogglePicker: vi.fn(),
    onClosePicker: vi.fn(),
    onCloseDrawer: vi.fn(),
    onClosePopover: vi.fn(),
    onCancelCreate: vi.fn(),
    onToggleShortcuts: vi.fn(),
    onAddCommentAtPlayhead: vi.fn(),
    onAddSectionAtPlayhead: vi.fn(),
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

  it('cmd-= anchors at the playhead when it is visible', () => {
    const viewport = defaultViewport();
    viewport.state.hZoom = 2;
    const stage = document.createElement('div');
    stage.className = 'stage';
    stage.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400,
      x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    document.body.appendChild(stage);
    const player = stubPlayer();
    player.state.duration = 100;
    player.currentTime = 25; // visible: anchor at 300
    renderHook(() => useKeyboard({ ...defaultOpts(), player, viewport }));
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: '=', metaKey: true }),
    );
    expect(viewport.zoomH).toHaveBeenCalledWith('in', expect.objectContaining({
      stageWidth: 600,
      anchorX: 300,
    }));
    document.body.removeChild(stage);
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

describe('useKeyboard WASD navigation', () => {
  function withViewport(): { viewportEl: HTMLDivElement; stageEl: HTMLDivElement } {
    const viewportEl = document.createElement('div');
    viewportEl.className = 'viewport';
    Object.defineProperty(viewportEl, 'clientWidth', { value: 600, configurable: true });
    Object.defineProperty(viewportEl, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty(viewportEl, 'scrollWidth', { value: 1800, configurable: true });
    Object.defineProperty(viewportEl, 'scrollHeight', { value: 800, configurable: true });
    viewportEl.scrollLeft = 600;
    viewportEl.scrollTop = 200;
    document.body.appendChild(viewportEl);

    const stageEl = document.createElement('div');
    stageEl.className = 'stage';
    stageEl.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400,
      x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    document.body.appendChild(stageEl);

    return { viewportEl, stageEl };
  }

  it('W calls viewport.zoomH("in") with center anchor', () => {
    const viewport = defaultViewport();
    const { viewportEl, stageEl } = withViewport();
    renderHook(() => useKeyboard({ ...defaultOpts(), viewport }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
    expect(viewport.zoomH).toHaveBeenCalledWith('in', expect.objectContaining({
      stageWidth: 600,
      anchorX: 300,
    }));
    document.body.removeChild(viewportEl);
    document.body.removeChild(stageEl);
  });

  it('S calls viewport.zoomH("out")', () => {
    const viewport = defaultViewport();
    const { viewportEl, stageEl } = withViewport();
    renderHook(() => useKeyboard({ ...defaultOpts(), viewport }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's' }));
    expect(viewport.zoomH).toHaveBeenCalledWith('out', expect.any(Object));
    document.body.removeChild(viewportEl);
    document.body.removeChild(stageEl);
  });

  it('Shift+W calls viewport.zoomV("in") instead of horizontal zoom', () => {
    const viewport = defaultViewport();
    const { viewportEl, stageEl } = withViewport();
    renderHook(() => useKeyboard({ ...defaultOpts(), viewport }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'W', shiftKey: true }));
    expect(viewport.zoomV).toHaveBeenCalledWith('in');
    expect(viewport.zoomH).not.toHaveBeenCalled();
    document.body.removeChild(viewportEl);
    document.body.removeChild(stageEl);
  });

  it('Shift+S calls viewport.zoomV("out") instead of horizontal zoom', () => {
    const viewport = defaultViewport();
    const { viewportEl, stageEl } = withViewport();
    renderHook(() => useKeyboard({ ...defaultOpts(), viewport }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'S', shiftKey: true }));
    expect(viewport.zoomV).toHaveBeenCalledWith('out');
    expect(viewport.zoomH).not.toHaveBeenCalled();
    document.body.removeChild(viewportEl);
    document.body.removeChild(stageEl);
  });

  it('A pans the viewport left via viewport.setScrollLeft', () => {
    const viewport = defaultViewport();
    const { viewportEl, stageEl } = withViewport();
    renderHook(() => useKeyboard({ ...defaultOpts(), viewport }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(viewport.setScrollLeft).toHaveBeenCalled();
    const call = viewport.setScrollLeft.mock.calls[0];
    expect(call[0]).toBe(600 - 100); // scrollLeft - step (clientWidth/6 = 100)
    document.body.removeChild(viewportEl);
    document.body.removeChild(stageEl);
  });

  it('D pans the viewport right', () => {
    const viewport = defaultViewport();
    const { viewportEl, stageEl } = withViewport();
    renderHook(() => useKeyboard({ ...defaultOpts(), viewport }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));
    expect(viewport.setScrollLeft).toHaveBeenCalled();
    const call = viewport.setScrollLeft.mock.calls[0];
    expect(call[0]).toBe(600 + 100);
    document.body.removeChild(viewportEl);
    document.body.removeChild(stageEl);
  });

  it('W anchors zoom at the playhead when it is visible', () => {
    const viewport = defaultViewport();
    viewport.state.hZoom = 2; // inner = 1200, scrollLeft 0 → visible 0..600
    const { viewportEl, stageEl } = withViewport();
    const player = stubPlayer();
    player.state.duration = 100;
    player.currentTime = 25; // 25/100 * 1200 = 300 inner, 300 - 0 scroll = 300 stageX
    renderHook(() => useKeyboard({ ...defaultOpts(), player, viewport }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
    expect(viewport.zoomH).toHaveBeenCalledWith('in', expect.objectContaining({
      stageWidth: 600,
      anchorX: 300,
    }));
    document.body.removeChild(viewportEl);
    document.body.removeChild(stageEl);
  });

  it('W falls back to center anchor when playhead is offscreen', () => {
    const viewport = defaultViewport();
    viewport.state.hZoom = 4; // inner = 2400
    viewport.state.scrollLeft = 0; // visible 0..600
    const { viewportEl, stageEl } = withViewport();
    const player = stubPlayer();
    player.state.duration = 100;
    player.currentTime = 50; // 50/100 * 2400 = 1200 inner → stageX 1200 (offscreen)
    renderHook(() => useKeyboard({ ...defaultOpts(), player, viewport }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
    expect(viewport.zoomH).toHaveBeenCalledWith('in', expect.objectContaining({
      stageWidth: 600,
      anchorX: 300,
    }));
    document.body.removeChild(viewportEl);
    document.body.removeChild(stageEl);
  });

  it('all four WASD keys suspend auto-follow', () => {
    for (const key of ['w', 'a', 's', 'd']) {
      const viewport = defaultViewport();
      const { viewportEl, stageEl } = withViewport();
      renderHook(() => useKeyboard({ ...defaultOpts(), viewport }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key }));
      expect(viewport.setFollowActive).toHaveBeenCalledWith(false);
      document.body.removeChild(viewportEl);
      document.body.removeChild(stageEl);
    }
  });

  it('C calls onAddCommentAtPlayhead', () => {
    const onAddCommentAtPlayhead = vi.fn();
    renderHook(() =>
      useKeyboard({ ...defaultOpts(), onAddCommentAtPlayhead }),
    );
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c' }));
    expect(onAddCommentAtPlayhead).toHaveBeenCalledOnce();
  });

  it('C does not fire in text inputs', () => {
    const onAddCommentAtPlayhead = vi.fn();
    renderHook(() =>
      useKeyboard({ ...defaultOpts(), onAddCommentAtPlayhead }),
    );
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }));
    expect(onAddCommentAtPlayhead).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it('WASD does not fire in text inputs', () => {
    const viewport = defaultViewport();
    const { viewportEl, stageEl } = withViewport();
    renderHook(() => useKeyboard({ ...defaultOpts(), viewport }));
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(viewport.setScrollLeft).not.toHaveBeenCalled();
    expect(viewport.zoomH).not.toHaveBeenCalled();
    document.body.removeChild(input);
    document.body.removeChild(viewportEl);
    document.body.removeChild(stageEl);
  });
});

