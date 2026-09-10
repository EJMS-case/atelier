import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles/tokens.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import AuthGate from './components/AuthGate.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthGate>
        <App />
      </AuthGate>
    </ErrorBoundary>
  </React.StrictMode>
)

// A deploy stops serving the previous build's hashed chunks, so a page that
// stayed open across it can fail its next lazy import — on 2026-09-10 that
// made Style Me (the code-split surface) error on every tap until a manual
// reload. Vite reports exactly this as `vite:preloadError`; reload once to
// pick up the fresh index. The guard stops a reload loop when the network is
// genuinely down or the reload didn't cure it — then the surface's own error
// message shows instead. The service worker's precache (public/sw.js) makes
// this a last resort rather than the normal path.
window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  let last = 0;
  try { last = Number(sessionStorage.getItem("atelier:chunkReloadAt")) || 0; } catch { /* private mode */ }
  if (Date.now() - last < 120000) return;
  try { sessionStorage.setItem("atelier:chunkReloadAt", String(Date.now())); } catch { /* private mode */ }
  window.location.reload();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {})
  })
}
