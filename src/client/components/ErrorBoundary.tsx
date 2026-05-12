import { Component, type ReactNode } from 'react';
import { recordClientError } from '../lib/clientErrorBuffer';
import type { ClientErrorEntry } from '../lib/clientErrorBuffer';

type Props = {
  children: ReactNode;
  onReportBug?: (prefill: {
    description?: string;
    errors?: ClientErrorEntry[];
  }) => void;
};
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error('Player crashed:', error);
    recordClientError(error);
  }

  private handleReport = (): void => {
    const error = this.state.error;
    if (!error) return;
    this.props.onReportBug?.({
      description: '[crash] ',
      errors: [
        {
          ts: new Date().toISOString(),
          message: error.message || error.name || 'Error',
          stack: error.stack,
        },
      ],
    });
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="empty error-boundary-fallback" style={{ padding: '40px 0' }}>
          <div>Something went wrong rendering the player. Reload to recover.</div>
          {this.props.onReportBug && (
            <button
              type="button"
              className="error-boundary-report"
              onClick={this.handleReport}
            >
              Report this
            </button>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
