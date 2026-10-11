import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { console.error('UI error', error?.message); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="main"><div className="banner banner-error" role="alert">
        <div className="stack">
          <p><strong>This page hit an unexpected problem.</strong> Your data is safe on the server.</p>
          <div><button type="button" className="btn btn-secondary btn-sm" onClick={() => window.location.reload()}>Reload the page</button></div>
        </div>
      </div></div>
    );
  }
}
