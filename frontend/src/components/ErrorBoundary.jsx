import React from "react";

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("UI error:", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: "system-ui", maxWidth: 640 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>Something went wrong on this page</h1>
          <p style={{ color: "#555", marginTop: 8 }}>
            Try another section or return home.
          </p>
          <pre style={{ marginTop: 16, padding: 12, background: "#f5f5f5", borderRadius: 8, fontSize: 12, overflow: "auto" }}>
            {String(this.state.error && this.state.error.message ? this.state.error.message : this.state.error)}
          </pre>
          <button
            type="button"
            style={{ marginTop: 16, padding: "8px 16px", borderRadius: 6, border: "1px solid #ccc", cursor: "pointer" }}
            onClick={() => {
              this.setState({ error: null });
              window.location.href = "/";
            }}
          >
            Go to home
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

