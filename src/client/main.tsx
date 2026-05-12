import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installClientErrorBuffer } from './lib/clientErrorBuffer';
import './styles/app.css';

installClientErrorBuffer();

const root = document.getElementById('root');
if (!root) throw new Error('No #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
