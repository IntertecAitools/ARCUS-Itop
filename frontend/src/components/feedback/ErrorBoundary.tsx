import { Component, type ErrorInfo, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui';

interface Props {
  children: ReactNode;
  /** Shown in the message so the user knows what failed. */
  label?: string;
}

interface State {
  error: Error | null;
}

/**
 * Wraps each routed module, so a crash in one module never blanks the shell —
 * the sidebar and topbar stay usable and the user can navigate away.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
        <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-critical-soft text-critical">
          <TriangleAlert className="size-5" aria-hidden />
        </div>
        <p className="text-sm font-semibold text-ink">
          {this.props.label ? `${this.props.label} failed to load` : 'Something went wrong'}
        </p>
        <p className="mt-1 max-w-md text-[13px] text-ink-muted">{error.message}</p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-4"
          onClick={() => this.setState({ error: null })}
        >
          Try again
        </Button>
      </div>
    );
  }
}
