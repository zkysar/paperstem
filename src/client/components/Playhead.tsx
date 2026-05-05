type Props = {
  visible: boolean;
  leftPx: number;
};

export function Playhead({ visible, leftPx }: Props) {
  if (!visible) return null;
  return <div className="playhead" style={{ left: `${leftPx}px` }} />;
}
