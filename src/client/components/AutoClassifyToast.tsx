// First-time toast shown when the user sees auto-detected sections for the
// first time. Mockup Flow D. Persists a `paperstem.hints.auto-classify.seen`
// flag in localStorage so it only appears once per device/user.
import { X } from 'lucide-react';

type Props = {
  // Count of detected sections to surface in the headline.
  count: number;
  onDismiss(): void;
};

export function AutoClassifyToast({ count, onDismiss }: Props) {
  return (
    <div className="auto-classify-toast" role="status">
      <span className="ac-toast-icon" aria-hidden="true" />
      <div className="ac-toast-body">
        <strong>
          {count} section{count === 1 ? '' : 's'} detected.
        </strong>{' '}
        Edit names or delete any you don't want.
        <span className="ac-toast-sub">
          We listened to the audio and grouped it into songs, chatter, and tuning.
        </span>
      </div>
      <button
        type="button"
        className="ac-toast-dismiss"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        <X size={14} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}
