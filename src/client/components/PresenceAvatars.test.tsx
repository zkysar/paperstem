import { render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
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

  it('renders nothing when the only viewer is the current user', () => {
    usePresenceMock.mockReturnValue(snap([
      { userId: 'u1', displayName: 'Me', emailLocal: 'me', state: 'active', lastBeatAt: 1 },
    ]));
    const { container } = render(
      <PresenceAvatars projectId="proj-A" currentUserId="u1" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('hides only the current user when others are also viewing', () => {
    usePresenceMock.mockReturnValue(snap([
      { userId: 'u1', displayName: 'Me',    emailLocal: 'me',    state: 'active', lastBeatAt: 5 },
      { userId: 'u2', displayName: 'Alice', emailLocal: 'alice', state: 'active', lastBeatAt: 4 },
      { userId: 'u3', displayName: 'Bob',   emailLocal: 'bob',   state: 'active', lastBeatAt: 3 },
    ]));
    render(<PresenceAvatars projectId="proj-A" currentUserId="u1" />);
    const labels = screen.getAllByTestId('presence-avatar').map((el) => el.getAttribute('aria-label'));
    expect(labels).toHaveLength(2);
    expect(labels.some((l) => l && /Me,/.test(l))).toBe(false);
    expect(labels.some((l) => l && /Alice/.test(l))).toBe(true);
    expect(labels.some((l) => l && /Bob/.test(l))).toBe(true);
  });

  it('still renders the anon chip when self is the only named viewer', () => {
    usePresenceMock.mockReturnValue(snap([
      { userId: 'u1', displayName: 'Me', emailLocal: 'me', state: 'active', lastBeatAt: 1 },
    ], 2));
    render(<PresenceAvatars projectId="proj-A" currentUserId="u1" />);
    expect(screen.queryAllByTestId('presence-avatar')).toHaveLength(0);
    expect(screen.getByTestId('presence-anon')).toHaveTextContent('2');
  });
});

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
    // Distinct, descending lastBeatAt values pin the avatar order: Alice (more
    // recent) sorts first, Bob second. Two bare Date.now() calls would tie most
    // of the time but occasionally differ by 1ms, flipping the sort and making
    // this test flaky (see the order() recency sort in PresenceAvatars).
    const now = Date.now();
    usePresenceMock.mockReturnValue(snap([
      { userId: 'u1', displayName: 'Alice', emailLocal: 'alice', state: 'active', lastBeatAt: now },
      { userId: 'u2', displayName: 'Bob',   emailLocal: 'bob',   state: 'active', lastBeatAt: now - 1 },
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
    expect(dialog).toHaveAttribute('aria-label', 'More viewers');
    // First 3 (A, B, C) are visible avatars; the list should contain D and E only.
    const { getAllByText, queryByText } = within(dialog);
    expect(getAllByText('D').length).toBeGreaterThan(0);
    expect(getAllByText('E').length).toBeGreaterThan(0);
    expect(queryByText('A')).toBeNull();
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

  it('toggles aria-expanded on the avatar button when popover opens and closes', () => {
    usePresenceMock.mockReturnValue(snap([
      { userId: 'u1', displayName: 'Alice', emailLocal: 'alice', state: 'active', lastBeatAt: Date.now() },
    ]));
    render(<PresenceAvatars projectId="proj-A" />);
    const btn = screen.getByTestId('presence-avatar');
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'false');
  });

  it('restores focus to the trigger when the popover closes via Escape', () => {
    usePresenceMock.mockReturnValue(snap([
      { userId: 'u1', displayName: 'Alice', emailLocal: 'alice', state: 'active', lastBeatAt: Date.now() },
    ]));
    render(<PresenceAvatars projectId="proj-A" />);
    const btn = screen.getByTestId('presence-avatar');
    btn.focus();
    expect(document.activeElement).toBe(btn);
    fireEvent.click(btn);
    fireEvent.keyDown(document, { key: 'Escape' });
    // After unmount, the popover's cleanup should restore focus.
    expect(document.activeElement).toBe(btn);
  });
});
