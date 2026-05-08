import { renderHook } from '@testing-library/react';
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

describe('useKeyboard cmd-K toggles picker', () => {
  it('cmd-K calls onTogglePicker', () => {
    const onTogglePicker = vi.fn();
    renderHook(() =>
      useKeyboard({
        player: stubPlayer(),
        pickerOpen: false,
        annotationsOpen: false,
        annotationCreateMode: false,
        onTogglePicker,
        onClosePicker: () => {},
        onCloseRail: () => {},
        onCancelCreate: () => {},
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
        player: stubPlayer(),
        pickerOpen: false,
        annotationsOpen: false,
        annotationCreateMode: false,
        onTogglePicker,
        onClosePicker: () => {},
        onCloseRail: () => {},
        onCancelCreate: () => {},
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
    const onCloseRail = vi.fn();
    const onCancelCreate = vi.fn();
    renderHook(() =>
      useKeyboard({
        player: stubPlayer(),
        pickerOpen: true,
        annotationsOpen: true,
        annotationCreateMode: true,
        onTogglePicker: () => {},
        onClosePicker,
        onCloseRail,
        onCancelCreate,
      }),
    );
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClosePicker).toHaveBeenCalledOnce();
    expect(onCloseRail).not.toHaveBeenCalled();
    expect(onCancelCreate).not.toHaveBeenCalled();
  });

  it('closes rail when picker closed and rail has focus', () => {
    document.body.innerHTML =
      '<div class="annotations-rail"><button id="b">x</button></div>';
    document.getElementById('b')?.focus();
    const onCloseRail = vi.fn();
    const onCancelCreate = vi.fn();
    renderHook(() =>
      useKeyboard({
        player: stubPlayer(),
        pickerOpen: false,
        annotationsOpen: true,
        annotationCreateMode: true,
        onTogglePicker: () => {},
        onClosePicker: () => {},
        onCloseRail,
        onCancelCreate,
      }),
    );
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onCloseRail).toHaveBeenCalledOnce();
    expect(onCancelCreate).not.toHaveBeenCalled();
    document.body.innerHTML = '';
  });

  it('cancels create-mode when picker closed and rail not focused', () => {
    const onCloseRail = vi.fn();
    const onCancelCreate = vi.fn();
    renderHook(() =>
      useKeyboard({
        player: stubPlayer(),
        pickerOpen: false,
        annotationsOpen: false,
        annotationCreateMode: true,
        onTogglePicker: () => {},
        onClosePicker: () => {},
        onCloseRail,
        onCancelCreate,
      }),
    );
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onCancelCreate).toHaveBeenCalledOnce();
    expect(onCloseRail).not.toHaveBeenCalled();
  });
});
