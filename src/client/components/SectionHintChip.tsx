import { useEffect, useRef } from 'react';

type Props = {
  visible: boolean;
  onDismiss(): void;
};

export function SectionHintChip({ visible, onDismiss }: Props) {
  const firedRef = useRef(false);

  useEffect(() => {
    if (!visible) {
      firedRef.current = false;
      return;
    }
    const handler = () => {
      if (firedRef.current) return;
      firedRef.current = true;
      onDismiss();
    };
    document.addEventListener('pointerdown', handler, { capture: true });
    document.addEventListener('touchstart', handler, { capture: true });
    window.addEventListener('scroll', handler, { capture: true });
    return () => {
      document.removeEventListener('pointerdown', handler, { capture: true });
      document.removeEventListener('touchstart', handler, { capture: true });
      window.removeEventListener('scroll', handler, { capture: true });
    };
  }, [visible, onDismiss]);

  if (!visible) return null;

  return (
    <div className="section-hint-chip" role="status" aria-live="polite">
      Tap for section labels
    </div>
  );
}
