import { Component, type ComponentProps, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";

type SafeCanvasProps = ComponentProps<typeof Canvas> & {
  /** Rendered instead of the 3D view when WebGL context creation fails. */
  fallback?: ReactNode;
};

/**
 * Error-boundary wrapper around the R3F Canvas. Without a GPU/WebGL context
 * the Canvas throws during render, which would otherwise unmount the whole app.
 */
export class SafeCanvas extends Component<SafeCanvasProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn("3D view disabled, WebGL context unavailable:", error);
  }

  render() {
    const { fallback, children, ...canvasProps } = this.props;
    if (this.state.failed) {
      return (
        fallback ?? (
          <div className="flex h-full w-full items-center justify-center p-4 text-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            WebGL unavailable — 3D view disabled
          </div>
        )
      );
    }
    return <Canvas {...canvasProps}>{children}</Canvas>;
  }
}
