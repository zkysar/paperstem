type Props = {
  active: boolean;
  onToggle(): void;
};

export function FollowPill({ active, onToggle }: Props) {
  return (
    <button
      type="button"
      className={'follow-pill' + (active ? ' active' : '')}
      onClick={onToggle}
      title={active ? 'Auto-follow is on. Click to suspend.' : 'Auto-follow is off. Click to resume.'}
    >
      Follow: {active ? 'on' : 'off'}
    </button>
  );
}
