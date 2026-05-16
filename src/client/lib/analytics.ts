import posthog from 'posthog-js';
import type { User } from '../../shared/types';

const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const host =
  (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ??
  'https://us.i.posthog.com';

let started = false;

export function initAnalytics(): void {
  if (started || !key) return;
  posthog.init(key, {
    api_host: host,
    capture_pageview: true,
    person_profiles: 'identified_only',
  });
  started = true;
}

export function identifyUser(user: User): void {
  if (!started) return;
  posthog.identify(user.id, {
    email: user.email,
    name: user.display_name ?? undefined,
  });
}

export function resetAnalytics(): void {
  if (!started) return;
  posthog.reset();
}
