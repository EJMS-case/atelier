// ── ERROR BOUNDARY ───────────────────────────────────────────────────────────
// Catches render-time throws so a single bad view (or a malformed row / AI JSON
// shape) degrades to a friendly card instead of unmounting the whole app to a
// blank white screen. Styles are hard-coded inline (no CSS-var / style-module
// dependency) so the fallback still renders even if something upstream is broken.

import { Component } from "react";

const btn = { padding: "9px 16px", borderRadius: 8, border: "1px solid #d8cfc6", background: "transparent", color: "#3a3330", fontSize: 13, cursor: "pointer" };
const btnPrimary = { padding: "9px 16px", borderRadius: 8, border: "none", background: "#2f5a44", color: "#fff", fontSize: 13, cursor: "pointer" };

export default class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("[Atelier] render error caught by boundary:", error, info?.componentStack); }
  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    const viewScoped = this.props.scope === "view";
    return (
      <div style={{ padding: "48px 20px", textAlign: "center", fontFamily: "system-ui, -apple-system, sans-serif", color: "#3a3330" }}>
        <div style={{ fontSize: 30, marginBottom: 10 }}>✦</div>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Something hiccuped</div>
        <div style={{ fontSize: 13, color: "#8a8079", maxWidth: 340, margin: "0 auto 18px", lineHeight: 1.5 }}>
          {viewScoped
            ? "This screen hit an error, but the rest of the app is fine — head back and keep going."
            : "The app hit an unexpected error. Reloading usually clears it, and your data is safe."}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          {this.props.onReset && (
            <button style={btn} onClick={() => { this.reset(); this.props.onReset(); }}>Go back</button>
          )}
          <button style={btnPrimary} onClick={() => window.location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}
