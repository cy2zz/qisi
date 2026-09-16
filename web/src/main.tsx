import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import 'katex/dist/katex.min.css';
import { App } from './App';
import './styles.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Missing root element');
}

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
