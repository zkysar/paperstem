import { lazy, Suspense, useEffect, useRef } from 'react';

const Picker = lazy(async () => {
  const [reactMod, dataMod] = await Promise.all([
    import('@emoji-mart/react'),
    import('@emoji-mart/data'),
  ]);
  return {
    default: function PickerWithData(
      props: React.ComponentProps<typeof reactMod.default>,
    ) {
      return <reactMod.default data={dataMod.default} {...props} />;
    },
  };
});

type Props = {
  isNarrow: boolean;
  anchorRect: DOMRect | null;
  onSelect(emoji: string): void;
  onClose(): void;
};

export function EmojiPicker({ isNarrow, anchorRect, onSelect, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    function onDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [onClose]);

  const POPOVER_WIDTH = 320;
  const style: React.CSSProperties = isNarrow
    ? {
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1000,
      }
    : anchorRect
      ? {
          position: 'fixed',
          left: Math.max(
            8,
            Math.min(window.innerWidth - POPOVER_WIDTH - 8, anchorRect.left),
          ),
          top: anchorRect.bottom + 6,
          zIndex: 1000,
        }
      : {};

  return (
    <div
      ref={ref}
      className={'emoji-picker-' + (isNarrow ? 'sheet' : 'popover')}
      style={style}
      role="dialog"
      aria-label="Choose an emoji"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <Suspense fallback={<div className="emoji-picker-loading">Loading...</div>}>
        <Picker
          onEmojiSelect={(e: { native: string }) => {
            onSelect(e.native);
            onClose();
          }}
          theme="light"
          previewPosition="none"
          skinTonePosition="none"
          dynamicWidth={true}
        />
      </Suspense>
    </div>
  );
}
