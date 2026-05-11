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

function defaultOpts() {
  return {
    player: stubPlayer(),
    pickerOpen: false,
    drawerOpen: false,
    popoverOpen: false,
    annotationCreateMode: false,
    onTogglePicker: vi.fn(),
    onClosePicker: vi.fn(),
    onCloseDrawer: vi.fn(),
    onClosePopover: vi.fn(),
    onCancelCreate: vi.fn(),
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
