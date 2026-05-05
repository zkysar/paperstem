import { Component, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error('Player crashed:', error);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="empty" style={{ padding: '40px 0' }}>
          Something went wrong rendering the player. Reload to recover.
        </div>
      );
    }
    return this.props.children;
  }
}
