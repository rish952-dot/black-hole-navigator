import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  label?: string;
}

interface State {
  error: Error | null;
}

/**
 * Top-level crash guard. A WebGL/render failure should show a recovery screen,
 * never a blank page in production.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", this.props.label ?? "app", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-background p-6 text-foreground">
        <div className="max-w-md space-y-4 text-center">
          <h1 className="font-mono text-sm uppercase tracking-[0.3em] text-primary">Rendering stopped</h1>
          <p className="text-sm text-muted-foreground">
            Something failed while drawing this view. Your simulation data is safe — reload to continue.
          </p>
          <pre className="max-h-32 overflow-auto rounded border border-border/60 bg-card/60 p-3 text-left font-mono text-[11px] text-muted-foreground">
            {error.message}
          </pre>
          <div className="flex justify-center gap-2">
            <Button size="sm" onClick={() => this.setState({ error: null })}>
              Try again
            </Button>
            <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
              Reload
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
