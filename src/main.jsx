import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerServiceWorker } from './backend/index.js';
import { AppProvider } from './react/hooks.jsx';
import App from './App.jsx';

registerServiceWorker();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
);
