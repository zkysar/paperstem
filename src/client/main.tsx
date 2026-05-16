import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { PublicProjectRouteWrapper } from './PublicProjectView';
import { installClientErrorBuffer } from './lib/clientErrorBuffer';
import './styles/app.css';

installClientErrorBuffer();

const root = document.getElementById('root');
if (!root) throw new Error('No #root element');

// Path-based public-link routing. The /p/<token> page boots its own minimal
// view that never imports the authenticated App (no FilePicker, no
// CommentsDrawer, no auth hooks). Keeping the two trees disjoint at the
// entry point is the simplest way to guarantee a public viewer can't
// surface admin UI by toggling state.
const isPublicRoute = /^\/p\/[A-Za-z0-9_-]+\/?$/.test(window.location.pathname);

createRoot(root).render(
  <StrictMode>{isPublicRoute ? <PublicProjectRouteWrapper /> : <App />}</StrictMode>,
);
