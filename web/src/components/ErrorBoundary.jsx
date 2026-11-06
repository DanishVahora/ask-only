import { Component } from "react";

/**
 * The last thing standing between a bug and a white page.
 *
 * Nothing is lost by reloading: documents are on the network, and this browser's
 * answering key is in IndexedDB, so it picks up again by itself.
 */
export default class ErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error("AskOnly crashed:", error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    // One page broke. The rest of the app, and the answering above it, carries on.
    if (this.props.inline) {
      return (
        <div className="mx-auto max-w-[28rem] px-6 py-24 text-center">
          <h1 className="text-[2rem] leading-[1.1]">This page broke.</h1>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-70">
            Answering carries on in the background. Go to another page, or reload this one.
          </p>
          <button className="btn btn-primary mt-6" onClick={() => location.reload()}>Reload</button>
        </div>
      );
    }
    return (
      <div className="grid min-h-dvh place-items-center bg-cream px-6 text-center">
        <div className="max-w-[28rem]">
          <h1 className="text-[2.5rem] leading-[1.05]">Something broke on this page.</h1>
          <p className="mt-4 text-[0.9375rem] leading-relaxed text-ink-70">
            Your documents are safe, and reloading loses nothing. Your browser will pick up answering by
            itself.
          </p>
          <button className="btn btn-primary btn-lg mt-6" onClick={() => location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}
