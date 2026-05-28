// src/miniapp/src/main.jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { TonConnectUIProvider } from '@tonconnect/ui-react';
import App from './App';
import './index.css';

const MANIFEST_URL = `${window.location.origin}/tonconnect-manifest.json`;

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="boot-error">
          <p className="eyebrow">Mini App Crash</p>
          <h1>Интерфейс не смог загрузиться</h1>
          <p>{this.state.error.message}</p>
        </div>
      );
    }

    return this.props.children;
  }
}

const rootElement = document.getElementById('root');

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <TonConnectUIProvider manifestUrl={MANIFEST_URL}>
        <App />
      </TonConnectUIProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
