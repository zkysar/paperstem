type Props = {
  visible: boolean;
  enabled: boolean;
  leftPx: number;
  widthPx: number;
  onMouseDown(e: React.MouseEvent<HTMLDivElement>): void;
};

export function LoopRegion({ visible, enabled, leftPx, widthPx, onMouseDown }: Props) {
  if (!visible) return null;
  return (
    <div
      className={'loop-region' + (enabled ? '' : ' disabled')}
      style={{ left: `${leftPx}px`, width: `${widthPx}px` }}
      onMouseDown={onMouseDown}
    >
      <div className="loop-handle left" data-handle="left" />
      <div className="loop-handle right" data-handle="right" />
    </div>
  );
}
