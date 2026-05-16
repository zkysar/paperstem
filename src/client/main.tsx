import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
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
//
// lazy() + Suspense splits the bundle: an anonymous viewer at /p/<token>
// downloads only the public chunk, not the FilePicker / UploadDrawer /
// BugReportDrawer / band-switcher code paths from App.
const isPublicRoute = /^\/p\/[A-Za-z0-9_-]+\/?$/.test(window.location.pathname);

const App = lazy(() => import('./App'));
const PublicProjectRouteWrapper = lazy(() =>
  import('./PublicProjectView').then((m) => ({
    default: m.PublicProjectRouteWrapper,
  })),
);

createRoot(root).render(
  <StrictMode>
    <Suspense fallback={null}>
      {isPublicRoute ? <PublicProjectRouteWrapper /> : <App />}
    </Suspense>
  </StrictMode>,
);
