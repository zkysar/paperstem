import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Playhead } from './Playhead';

function baseProps(over: Partial<Parameters<typeof Playhead>[0]> = {}) {
  // Identity-ish helpers: leftPx == clientX, time == clientX / 10.
  return {
    visible: true,
    leftPx: 100,
    clientXToLeftPx: (x: number) => x,
    clientXToTime: (x: number) => x / 10,
    onSeek: vi.fn(),
    ...over,
  };
}

describe('Playhead', () => {
  it('renders nothing when not visible', () => {
    const { container } = render(<Playhead {...baseProps({ visible: false })} />);
    expect(container.querySelector('.playhead')).toBeNull();
  });

  it('renders the handle when visible', () => {
    render(<Playhead {...baseProps()} />);
    expect(screen.getByRole('slider')).not.toBeNull();
  });

  it('drag past threshold then pointerup calls onSeek with the target time', () => {
    const onSeek = vi.fn();
    render(<Playhead {...baseProps({ onSeek })} />);
    const handle = screen.getByRole('slider');

    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 100 });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 250 });
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 250 });

    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(25); // 250 / 10
  });

  it('click without moving past the threshold does not seek', () => {
    const onSeek = vi.fn();
    render(<Playhead {...baseProps({ onSeek })} />);
    const handle = screen.getByRole('slider');

    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 100 });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 102 }); // < 4px threshold
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 102 });

    expect(onSeek).not.toHaveBeenCalled();
  });

  it('pointercancel mid-drag does not seek', () => {
    const onSeek = vi.fn();
    render(<Playhead {...baseProps({ onSeek })} />);
    const handle = screen.getByRole('slider');

    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 100 });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 250 });
    fireEvent.pointerCancel(document, { pointerId: 1, clientX: 250 });

    expect(onSeek).not.toHaveBeenCalled();
  });

  it('Escape mid-drag does not seek', () => {
    const onSeek = vi.fn();
    render(<Playhead {...baseProps({ onSeek })} />);
    const handle = screen.getByRole('slider');

    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 100 });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 250 });
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onSeek).not.toHaveBeenCalled();
  });

  it('non-primary mouse button does not start a drag', () => {
    const onSeek = vi.fn();
    render(<Playhead {...baseProps({ onSeek })} />);
    const handle = screen.getByRole('slider');

    fireEvent.pointerDown(handle, { pointerId: 1, button: 2, clientX: 100 });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 250 });
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 250 });

    expect(onSeek).not.toHaveBeenCalled();
  });
});
