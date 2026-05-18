import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const usePresenceMock = vi.fn();
vi.mock('../hooks/usePresence', () => ({
  usePresence: (ids: string[]) => usePresenceMock(ids),
}));

import { PresenceAvatars } from './PresenceAvatars';

function snap(rows: any[], anonymousCount = 0) {
  return { 'proj-A': { rows, anonymousCount } };
}

describe('<PresenceAvatars />', () => {
  it('renders nothing when no rows and no anonymous viewers', () => {
    usePresenceMock.mockReturnValue(snap([]));
    const { container } = render(<PresenceAvatars projectId="proj-A" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders up to 3 member avatars and an overflow chip for the rest', () => {
    usePresenceMock.mockReturnValue(snap([
      { userId: 'u1', displayName: 'Alice',   emailLocal: 'alice', state: 'active', lastBeatAt: 5 },
      { userId: 'u2', displayName: 'Bob',     emailLocal: 'bob', state: 'active', lastBeatAt: 4 },
      { userId: 'u3', displayName: 'Charlie', emailLocal: 'charlie', state: 'idle',   lastBeatAt: 3 },
      { userId: 'u4', displayName: 'Dora',    emailLocal: 'dora', state: 'idle',   lastBeatAt: 2 },
      { userId: 'u5', displayName: 'Eve',     emailLocal: 'eve', state: 'idle',   lastBeatAt: 1 },
    ]));
    render(<PresenceAvatars projectId="proj-A" />);
    expect(screen.getAllByTestId('presence-avatar')).toHaveLength(3);
    expect(screen.getByTestId('presence-overflow')).toHaveTextContent('+2');
  });

  it('orders active members ahead of idle, both by recency desc', () => {
    usePresenceMock.mockReturnValue(snap([
      { userId: 'u1', displayName: 'OldActive',   emailLocal: 'oldactive', state: 'active', lastBeatAt: 1 },
      { userId: 'u2', displayName: 'NewIdle',     emailLocal: 'newidle', state: 'idle',   lastBeatAt: 10 },
      { userId: 'u3', displayName: 'NewerActive', emailLocal: 'neweractive', state: 'active', lastBeatAt: 5 },
    ]));
    render(<PresenceAvatars projectId="proj-A" />);
    const labels = screen.getAllByTestId('presence-avatar').map((el) => el.getAttribute('aria-label'));
    expect(labels[0]).toMatch(/NewerActive/);
    expect(labels[1]).toMatch(/OldActive/);
    expect(labels[2]).toMatch(/NewIdle/);
  });

  it('renders an anonymous chip when anonymousCount > 0', () => {
    usePresenceMock.mockReturnValue(snap([], 2));
    render(<PresenceAvatars projectId="proj-A" />);
    const chip = screen.getByTestId('presence-anon');
    expect(chip).toHaveTextContent('2');
    expect(chip).toHaveAttribute('aria-label', '2 anonymous viewers');
  });

  it('marks idle members in the aria-label and applies the idle class', () => {
    usePresenceMock.mockReturnValue(snap([
      { userId: 'u1', displayName: 'Alice', emailLocal: 'alice', state: 'idle', lastBeatAt: 1 },
    ]));
    render(<PresenceAvatars projectId="proj-A" />);
    const av = screen.getByTestId('presence-avatar');
    expect(av).toHaveAttribute('aria-label', expect.stringMatching(/Alice.*idle/));
    expect(av.className).toMatch(/presence-avatar-idle/);
  });

  it('dedupes the same userId across multiple tabs; active wins over idle', () => {
    usePresenceMock.mockReturnValue(snap([
      { userId: 'u1', displayName: 'Alice', emailLocal: 'alice', state: 'idle',   lastBeatAt: 5 },
      { userId: 'u1', displayName: 'Alice', emailLocal: 'alice', state: 'active', lastBeatAt: 10 },
      { userId: 'u2', displayName: 'Bob',   emailLocal: 'bob', state: 'active', lastBeatAt: 8 },
    ]));
    render(<PresenceAvatars projectId="proj-A" />);
    const avs = screen.getAllByTestId('presence-avatar');
    expect(avs).toHaveLength(2);
    expect(avs[0].getAttribute('aria-label')).toMatch(/Alice.*active/);
  });

  it('keeps anonymous (null-userId) rows separate from each other', () => {
    usePresenceMock.mockReturnValue(snap([
      { userId: null, displayName: 'X', emailLocal: null, state: 'active', lastBeatAt: 1 },
      { userId: null, displayName: 'Y', emailLocal: null, state: 'active', lastBeatAt: 2 },
    ]));
    render(<PresenceAvatars projectId="proj-A" />);
    expect(screen.getAllByTestId('presence-avatar')).toHaveLength(2);
  });
});
