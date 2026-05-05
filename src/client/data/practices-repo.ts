import type { Practice } from './types';

export interface PracticesRepo {
  list(): Promise<Practice[]>;
}

// Reads ./practices.json relative to the deployed app. The file is in public/
// so it's served at the site's base path. Future implementations of this
// interface will hit a real backend; only this file changes.
export class StaticPracticesRepo implements PracticesRepo {
  private readonly url: string;

  constructor(url = `${import.meta.env.BASE_URL}practices.json`) {
    this.url = url;
  }

  async list(): Promise<Practice[]> {
    const res = await fetch(this.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { practices?: Practice[] };
    return data.practices ?? [];
  }
}
