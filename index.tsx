import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// Fontes locais (antes vinham do Google Fonts). Mesmos pesos de antes.
import '@fontsource/plus-jakarta-sans/300.css';
import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/500.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import '@fontsource/plus-jakarta-sans/800.css';
import '@fontsource/plus-jakarta-sans/400-italic.css';
import '@fontsource/plus-jakarta-sans/600-italic.css';
// Inter: impressão do orçamento (pages/Quotes.tsx).
import '@fontsource/inter/400.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/900.css';
import './index.css';

// Global error handling for easier debugging
window.onerror = function (message, source, lineno, colno, error) {
  alert(`Erro detectado: ${message}\nLink: ${source}:${lineno}`);
  return false;
};

window.onunhandledrejection = function (event) {
  alert(`Promessa rejeitada: ${event.reason}`);
};

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
