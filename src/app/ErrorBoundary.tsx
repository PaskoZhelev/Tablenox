import { Component, type ErrorInfo, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Tablenox crashed', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="center-message" role="alert">
        <h1>Something went wrong</h1>
        <p>{this.state.error.message}</p>
        <p className="hint">Your last saved state is still in this browser.</p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            this.setState({ error: null });
            window.location.hash = '#/';
          }}
        >
          Back to library
        </button>
      </div>
    );
  }
}
