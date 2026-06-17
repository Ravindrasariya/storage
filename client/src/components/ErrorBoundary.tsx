import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log full details so a production (minified) crash is still diagnosable
    // from the browser console.
    console.error("Application error caught by ErrorBoundary:", error, errorInfo);
    this.setState({ error, errorInfo });
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      const { error, errorInfo } = this.state;
      const details = [
        error?.message ? `Error: ${error.message}` : "",
        error?.stack ? `\n${error.stack}` : "",
        errorInfo?.componentStack ? `\nComponent stack:${errorInfo.componentStack}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      return (
        <div
          className="min-h-screen flex items-center justify-center bg-background p-4"
          data-testid="error-boundary"
        >
          <div className="w-full max-w-lg rounded-lg border bg-card p-6 shadow-sm text-center">
            <h1 className="text-xl font-bold text-foreground">
              Something went wrong
            </h1>
            <p className="mt-1 text-sm text-muted-foreground" lang="hi">
              कुछ गड़बड़ हो गई
            </p>
            <p className="mt-4 text-sm text-muted-foreground">
              The page ran into an unexpected problem. Please reload. If it keeps
              happening, contact support: KrashuVed — 8882589392.
            </p>
            <button
              type="button"
              onClick={this.handleReload}
              className="mt-5 inline-flex items-center justify-center rounded-md bg-chart-1 px-4 py-2 text-sm font-semibold text-white hover:bg-chart-1/90"
              data-testid="button-reload-app"
            >
              Reload page
            </button>

            {details && (
              <details className="mt-5 text-left">
                <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                  Technical details
                </summary>
                <pre
                  className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-[11px] text-muted-foreground"
                  data-testid="text-error-details"
                >
                  {details}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
