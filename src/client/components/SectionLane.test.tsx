import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { SectionLane } from './SectionLane';
import type { Section } from '../../shared/types';

function section(over: Partial<Section>): Section {
  return {
    id: 'sec-1',
    project_id: 'p-1',
    start_ms: 0,
    song_id: null,
    song_name: null,
    label: null,
    source: 'manual',
    created_at: 0,
    updated_at: 0,
    ...over,
  };
}

const baseProps = {
  sections: [] as Section[],
  duration: 120,
  waveLeftPx: 100,
  waveWidthPx: 800,
  songUseCounts: new Map<string, number>(),
  activeSectionId: null as string | null,
  expanded: true,
  interactionDisabled: false,
  onSelect: vi.fn(),
  onSeek: vi.fn(),
  onHoverChange: vi.fn(),
  onTapToExpand: vi.fn(),
};

describe('SectionLane', () => {
  it('renders nothing when there are no sections', () => {
    const { container } = render(<SectionLane {...baseProps} />);
    expect(container.querySelector('.section-lane')).toBeNull();
  });

  it('renders one pill per section, with the song name as the label', () => {
    render(
      <SectionLane
        {...baseProps}
        sections={[
          section({ id: 'a', start_ms: 0, song_id: 'song-1', song_name: 'Heart Sounds' }),
          section({ id: 'b', start_ms: 30000, song_id: 'song-2', song_name: 'Solo Idea' }),
        ]}
      />,
    );
    expect(screen.getByText('Heart Sounds')).not.toBeNull();
    expect(screen.getByText('Solo Idea')).not.toBeNull();
  });

  it('falls back to the label for free-text sections', () => {
    render(
      <SectionLane
        {...baseProps}
        sections={[section({ id: 'a', start_ms: 0, label: 'warmup' })]}
      />,
    );
    expect(screen.getByText('warmup')).not.toBeNull();
  });

  it('shows the chain glyph for sections whose song is shared across practices', () => {
    const { container } = render(
      <SectionLane
        {...baseProps}
        sections={[section({ id: 'a', start_ms: 0, song_id: 'song-1', song_name: 'Heart Sounds' })]}
        songUseCounts={new Map([['song-1', 3]])}
      />,
    );
    expect(container.querySelector('.section-pill-chain')).not.toBeNull();
  });

  it('does not show the chain glyph when use_count is 1', () => {
    const { container } = render(
      <SectionLane
        {...baseProps}
        sections={[section({ id: 'a', start_ms: 0, song_id: 'song-1', song_name: 'Heart Sounds' })]}
        songUseCounts={new Map([['song-1', 1]])}
      />,
    );
    expect(container.querySelector('.section-pill-chain')).toBeNull();
  });

  it('dragging a section left edge calls onPatchSection with snapped new start_ms', async () => {
    const onPatchSection = vi.fn(async () => {});
    const sections = [
      section({ id: 's1', start_ms: 0 }),
      section({ id: 's2', start_ms: 60000 }),
    ];
    render(
      <SectionLane
        {...baseProps}
        sections={sections}
        onPatchSection={onPatchSection}
        activeSectionId="s2"
      />,
    );
    const grip = document.querySelector(
      '[data-testid="section-s2"] .section-grip-left',
    )!;
    (grip as any).setPointerCapture = vi.fn();
    (grip as any).releasePointerCapture = vi.fn();

    fireEvent.pointerDown(grip, { clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 530, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 530, pointerId: 1 });

    // baseProps: waveLeftPx=100, waveWidthPx=800, duration=120 -> 150ms/px.
    // 30px * 150ms/px = 4500ms; snap-10 -> 4500. New start_ms = 60000 + 4500 = 64500.
    expect(onPatchSection).toHaveBeenCalledWith('s2', { start_ms: 64500 });
  });

  it('clicking a pill seeks and selects', async () => {
    const onSelect = vi.fn();
    const onSeek = vi.fn();
    const user = userEvent.setup();
    const s = section({ id: 'a', start_ms: 12000, song_id: 'song-1', song_name: 'Heart Sounds' });
    render(
      <SectionLane
        {...baseProps}
        sections={[s]}
        onSelect={onSelect}
        onSeek={onSeek}
      />,
    );
    await user.click(screen.getByText('Heart Sounds'));
    expect(onSeek).toHaveBeenCalledWith(12);
    expect(onSelect).toHaveBeenCalledWith(s);
  });

  it('renders the ribbon (no labels, no pills) when expanded is false', () => {
    const { container } = render(
      <SectionLane
        {...baseProps}
        expanded={false}
        sections={[
          section({ id: 'a', start_ms: 0, song_id: 'song-1', song_name: 'Heart Sounds' }),
          section({ id: 'b', start_ms: 30000, song_id: 'song-2', song_name: 'Solo Idea' }),
        ]}
      />,
    );
    expect(container.querySelector('.section-ribbon')).not.toBeNull();
    expect(container.querySelector('.section-pill')).toBeNull();
    expect(container.querySelectorAll('.section-ribbon-seg')).toHaveLength(2);
    expect(container.textContent ?? '').not.toContain('Heart Sounds');
    expect(container.textContent ?? '').not.toContain('Solo Idea');
  });

  it('omits the trailing divider on ribbon segments narrower than 8px', () => {
    const { container } = render(
      <SectionLane
        {...baseProps}
        expanded={false}
        duration={1000}
        sections={[
          section({ id: 'a', start_ms: 0 }),
          section({ id: 'b', start_ms: 5 }),
          section({ id: 'c', start_ms: 500000 }),
        ]}
      />,
    );
    const segs = container.querySelectorAll<HTMLElement>('.section-ribbon-seg');
    expect(segs).toHaveLength(3);
    expect(segs[0].classList.contains('has-divider')).toBe(false);
    expect(segs[1].classList.contains('has-divider')).toBe(false);
    expect(segs[2].classList.contains('has-divider')).toBe(false);
  });

  it('clicking a ribbon segment seeks and selects (same handlers as pills)', async () => {
    const onSelect = vi.fn();
    const onSeek = vi.fn();
    const user = userEvent.setup();
    const s = section({ id: 'a', start_ms: 12000, song_id: 'song-1', song_name: 'Heart Sounds' });
    const { container } = render(
      <SectionLane
        {...baseProps}
        expanded={false}
        sections={[s]}
        onSelect={onSelect}
        onSeek={onSeek}
      />,
    );
    const seg = container.querySelector<HTMLButtonElement>('.section-ribbon-seg');
    expect(seg).not.toBeNull();
    await user.click(seg!);
    expect(onSeek).toHaveBeenCalledWith(12);
    expect(onSelect).toHaveBeenCalledWith(s);
  });

  it('sets pointer-events: none on the wrapper when interactionDisabled is true', () => {
    const { container } = render(
      <SectionLane
        {...baseProps}
        expanded={false}
        interactionDisabled
        sections={[section({ id: 'a', start_ms: 0 })]}
      />,
    );
    const wrap = container.querySelector<HTMLElement>('.section-lane-wrap');
    expect(wrap).not.toBeNull();
    expect(wrap!.classList.contains('disabled')).toBe(true);
  });

  it('fires onHoverChange(true) on mouse enter of a ribbon segment, and (false) on mouse leave of the wrapper', () => {
    const onHoverChange = vi.fn();
    const { container } = render(
      <SectionLane
        {...baseProps}
        expanded={false}
        sections={[section({ id: 'a', start_ms: 0 })]}
        onHoverChange={onHoverChange}
      />,
    );
    const wrap = container.querySelector<HTMLElement>('.section-lane-wrap');
    const seg = container.querySelector<HTMLElement>('.section-ribbon-seg');
    fireEvent.mouseEnter(seg!);
    expect(onHoverChange).toHaveBeenLastCalledWith(true);
    fireEvent.mouseLeave(wrap!);
    expect(onHoverChange).toHaveBeenLastCalledWith(false);
  });

  it('does NOT fire onHoverChange(true) when hovering empty space in the wrapper (between/outside sections)', () => {
    const onHoverChange = vi.fn();
    const { container } = render(
      <SectionLane
        {...baseProps}
        expanded={false}
        sections={[section({ id: 'a', start_ms: 0 })]}
        onHoverChange={onHoverChange}
      />,
    );
    const wrap = container.querySelector<HTMLElement>('.section-lane-wrap');
    fireEvent.mouseEnter(wrap!);
    expect(onHoverChange).not.toHaveBeenCalledWith(true);
  });

  it('fires onTapToExpand on pointerdown on a ribbon segment when collapsed', () => {
    const onTapToExpand = vi.fn();
    const { container } = render(
      <SectionLane
        {...baseProps}
        expanded={false}
        sections={[section({ id: 'a', start_ms: 0 })]}
        onTapToExpand={onTapToExpand}
      />,
    );
    const seg = container.querySelector<HTMLElement>('.section-ribbon-seg');
    fireEvent.pointerDown(seg!);
    expect(onTapToExpand).toHaveBeenCalledOnce();
  });

  it('does NOT fire onTapToExpand on pointerdown on empty wrap space', () => {
    const onTapToExpand = vi.fn();
    const { container } = render(
      <SectionLane
        {...baseProps}
        expanded={false}
        sections={[section({ id: 'a', start_ms: 0 })]}
        onTapToExpand={onTapToExpand}
      />,
    );
    const wrap = container.querySelector<HTMLElement>('.section-lane-wrap');
    fireEvent.pointerDown(wrap!);
    expect(onTapToExpand).not.toHaveBeenCalled();
  });

  it('does NOT fire onTapToExpand on pointerdown when already expanded', () => {
    const onTapToExpand = vi.fn();
    const { container } = render(
      <SectionLane
        {...baseProps}
        expanded
        sections={[section({ id: 'a', start_ms: 0 })]}
        onTapToExpand={onTapToExpand}
      />,
    );
    const wrap = container.querySelector<HTMLElement>('.section-lane-wrap');
    fireEvent.pointerDown(wrap!);
    expect(onTapToExpand).not.toHaveBeenCalled();
  });

  it('middle drag of a section translates self + next by same delta', async () => {
    const onPatchSection = vi.fn(async () => {});
    const sections = [
      section({ id: 's1', start_ms: 0 }),
      section({ id: 's2', start_ms: 30000 }),
      section({ id: 's3', start_ms: 90000 }),
    ];
    render(
      <SectionLane
        {...baseProps}
        sections={sections}
        onPatchSection={onPatchSection}
        activeSectionId="s2"
      />,
    );
    const pill = screen.getByTestId('section-s2');
    (pill as any).setPointerCapture = vi.fn();
    (pill as any).releasePointerCapture = vi.fn();

    fireEvent.pointerDown(pill, { clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 540, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 540, pointerId: 1 });

    expect(onPatchSection).toHaveBeenCalledWith('s2', { start_ms: 36000 });
    expect(onPatchSection).toHaveBeenCalledWith('s3', { start_ms: 96000 });
  });

  it('middle drag of the last section shifts its start_ms (no next to translate, so it grows/shrinks against the song end)', async () => {
    const onPatchSection = vi.fn(async () => {});
    const sections = [
      section({ id: 's1', start_ms: 0 }),
      section({ id: 's2', start_ms: 60000 }),
    ];
    render(
      <SectionLane
        {...baseProps}
        sections={sections}
        onPatchSection={onPatchSection}
        activeSectionId="s2"
      />,
    );
    const pill = screen.getByTestId('section-s2');
    (pill as any).setPointerCapture = vi.fn();
    (pill as any).releasePointerCapture = vi.fn();

    fireEvent.pointerDown(pill, { clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 540, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 540, pointerId: 1 });

    // 40px * 150ms/px = 6000ms; new start = 60000 + 6000 = 66000.
    expect(onPatchSection).toHaveBeenCalledWith('s2', { start_ms: 66000 });
    // Only s2 patched — there is no next section to translate.
    expect(onPatchSection).toHaveBeenCalledTimes(1);
  });

  it('a dragged pill does not also fire its click — no dialog should open after a drag', () => {
    const onPatchSection = vi.fn(async () => {});
    const onSelect = vi.fn();
    const onSeek = vi.fn();
    const sections = [
      section({ id: 's1', start_ms: 0 }),
      section({ id: 's2', start_ms: 30000 }),
      section({ id: 's3', start_ms: 90000 }),
    ];
    render(
      <SectionLane
        {...baseProps}
        sections={sections}
        onPatchSection={onPatchSection}
        onSelect={onSelect}
        onSeek={onSeek}
        activeSectionId="s2"
      />,
    );
    const pill = screen.getByTestId('section-s2');
    (pill as any).setPointerCapture = vi.fn();
    (pill as any).releasePointerCapture = vi.fn();

    fireEvent.pointerDown(pill, { clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 540, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 540, pointerId: 1 });
    fireEvent.click(pill, { clientX: 540 });

    expect(onPatchSection).toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(onSeek).not.toHaveBeenCalled();
  });

  it('clicking a pill below the drag threshold still seeks and selects', () => {
    const onSelect = vi.fn();
    const onSeek = vi.fn();
    const sections = [
      section({ id: 's1', start_ms: 0 }),
      section({ id: 's2', start_ms: 60000 }),
    ];
    render(
      <SectionLane
        {...baseProps}
        sections={sections}
        onSelect={onSelect}
        onSeek={onSeek}
      />,
    );
    fireEvent.click(screen.getByTestId('section-s2'));
    expect(onSelect).toHaveBeenCalled();
    expect(onSeek).toHaveBeenCalled();
  });

  it('clamps section left-edge drag at 250ms from previous boundary', async () => {
    const onPatchSection = vi.fn(async () => {});
    const sections = [
      section({ id: 's1', start_ms: 10000 }),
      section({ id: 's2', start_ms: 12000 }),
    ];
    render(
      <SectionLane
        {...baseProps}
        sections={sections}
        onPatchSection={onPatchSection}
        activeSectionId="s2"
      />,
    );
    const grip = document.querySelector(
      '[data-testid="section-s2"] .section-grip-left',
    )!;
    (grip as any).setPointerCapture = vi.fn();
    (grip as any).releasePointerCapture = vi.fn();

    fireEvent.pointerDown(grip, { clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 0, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 0, pointerId: 1 });

    expect(onPatchSection).toHaveBeenCalledWith('s2', { start_ms: 10250 });
  });

  it('snaps section drag to nearest 10ms', async () => {
    const onPatchSection = vi.fn(async () => {});
    const customProps = {
      ...baseProps,
      duration: 2,
    };
    const sections = [
      section({ id: 's1', start_ms: 0 }),
      section({ id: 's2', start_ms: 1000 }),
    ];
    render(
      <SectionLane
        {...customProps}
        sections={sections}
        onPatchSection={onPatchSection}
        activeSectionId="s2"
      />,
    );
    const grip = document.querySelector(
      '[data-testid="section-s2"] .section-grip-left',
    )!;
    (grip as any).setPointerCapture = vi.fn();
    (grip as any).releasePointerCapture = vi.fn();

    fireEvent.pointerDown(grip, { clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 503, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 503, pointerId: 1 });

    expect(onPatchSection).toHaveBeenCalledWith('s2', { start_ms: 1010 });
  });

  it('mouseLeave on the wrap during a drag does not fire onHoverChange(false) — the pill must stay mounted for the drag to land', () => {
    const onHoverChange = vi.fn();
    const onPatchSection = vi.fn(async () => {});
    const sections = [
      section({ id: 's1', start_ms: 0 }),
      section({ id: 's2', start_ms: 30000 }),
      section({ id: 's3', start_ms: 90000 }),
    ];
    const { container } = render(
      <SectionLane
        {...baseProps}
        sections={sections}
        onPatchSection={onPatchSection}
        onHoverChange={onHoverChange}
        activeSectionId="s2"
      />,
    );
    const pill = screen.getByTestId('section-s2');
    (pill as any).setPointerCapture = vi.fn();
    (pill as any).releasePointerCapture = vi.fn();
    const wrap = container.querySelector<HTMLElement>('.section-lane-wrap')!;

    fireEvent.pointerDown(pill, { clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 540, pointerId: 1 });
    // Simulate the cursor drifting vertically out of the 22px wrap mid-drag.
    fireEvent.mouseLeave(wrap);
    expect(onHoverChange).not.toHaveBeenCalledWith(false);

    fireEvent.pointerUp(window, { clientX: 540, pointerId: 1 });
    // After the drag ends, mouseLeave should again collapse the lane.
    fireEvent.mouseLeave(wrap);
    expect(onHoverChange).toHaveBeenCalledWith(false);
  });

  it('stamps the section pill with the .dragging class for the lifetime of a middle-drag so the grabbing cursor does not depend on :active', () => {
    const onPatchSection = vi.fn(async () => {});
    const sections = [
      section({ id: 's1', start_ms: 0 }),
      section({ id: 's2', start_ms: 60000 }),
      section({ id: 's3', start_ms: 90000 }),
    ];
    render(
      <SectionLane
        {...baseProps}
        sections={sections}
        onPatchSection={onPatchSection}
        activeSectionId="s2"
      />,
    );
    const pill = screen.getByTestId('section-s2');
    (pill as any).setPointerCapture = vi.fn();
    (pill as any).releasePointerCapture = vi.fn();

    expect(pill.classList.contains('dragging')).toBe(false);
    fireEvent.pointerDown(pill, { clientX: 500, pointerId: 1 });
    expect(pill.classList.contains('dragging')).toBe(true);
    fireEvent.pointerMove(window, { clientX: 540, pointerId: 1 });
    expect(pill.classList.contains('dragging')).toBe(true);
    fireEvent.pointerUp(window, { clientX: 540, pointerId: 1 });
    expect(pill.classList.contains('dragging')).toBe(false);
  });

  it('Escape during section drag cancels the patch', async () => {
    const onPatchSection = vi.fn(async () => {});
    const sections = [
      section({ id: 's1', start_ms: 0 }),
      section({ id: 's2', start_ms: 60000 }),
    ];
    render(
      <SectionLane
        {...baseProps}
        sections={sections}
        onPatchSection={onPatchSection}
        activeSectionId="s2"
      />,
    );
    const grip = document.querySelector(
      '[data-testid="section-s2"] .section-grip-left',
    )!;
    (grip as any).setPointerCapture = vi.fn();
    (grip as any).releasePointerCapture = vi.fn();

    fireEvent.pointerDown(grip, { clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 530, pointerId: 1 });
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.pointerUp(window, { clientX: 530, pointerId: 1 });

    expect(onPatchSection).not.toHaveBeenCalled();
  });
});
