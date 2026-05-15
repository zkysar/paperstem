// Thin progress banner shown above the DAW in draft mode while auto-
// classification is running. Mockup Flow B. Non-blocking — user can still
// play, scrub, save mid-detection.
type Props = {
  // 0..1 progress reported by the Stage 1 orchestrator.
  progress: number;
};

export function DetectionBanner({ progress }: Props) {
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  return (
    <div className="detection-banner" role="status">
      <div className="detection-banner-spinner" aria-hidden="true" />
      <span className="detection-banner-label">
        <strong>Detecting sections</strong> — finds songs, chatter, and tuning
        automatically
      </span>
      <span className="detection-banner-num">{pct}%</span>
      <div className="detection-banner-bar-wrap" aria-hidden="true">
        <div
          className="detection-banner-bar"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
