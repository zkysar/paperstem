type Props = {
  visible: boolean;
  leftPx: number;
};

export function DragGuideline({ visible, leftPx }: Props) {
  if (!visible) return null;
  return (
    <div
      className="drag-guideline"
      aria-hidden="true"
      style={{ left: `${leftPx}px` }}
    />
  );
}
