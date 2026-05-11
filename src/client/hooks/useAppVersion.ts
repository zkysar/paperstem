import { useEffect, useState } from 'react';

export type AppVersion = {
  version: string;
  env: string;
};

export function useAppVersion(): AppVersion | null {
  const [data, setData] = useState<AppVersion | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/version', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled || !body) return;
        if (typeof body.version !== 'string' || typeof body.env !== 'string') return;
        setData({ version: body.version, env: body.env });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return data;
}
