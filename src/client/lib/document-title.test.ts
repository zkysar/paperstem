import { describe, expect, test } from 'vitest';
import { buildDocumentTitle } from './document-title';

describe('buildDocumentTitle', () => {
  test('prod (or unknown env) uses the bare brand', () => {
    expect(buildDocumentTitle('prod')).toBe('Paperstem');
    expect(buildDocumentTitle(null)).toBe('Paperstem');
    expect(buildDocumentTitle(undefined)).toBe('Paperstem');
  });

  test('non-prod env is uppercased and bracketed', () => {
    expect(buildDocumentTitle('local')).toBe('[LOCAL] Paperstem');
    expect(buildDocumentTitle('dev')).toBe('[DEV] Paperstem');
  });

  test('an open project is prepended to the brand', () => {
    expect(buildDocumentTitle('prod', 'Encore arrangement')).toBe(
      'Encore arrangement — Paperstem',
    );
    expect(buildDocumentTitle('local', 'Encore arrangement')).toBe(
      'Encore arrangement — [LOCAL] Paperstem',
    );
  });

  test('blank/absent project titles fall back to the brand', () => {
    expect(buildDocumentTitle('prod', null)).toBe('Paperstem');
    expect(buildDocumentTitle('local', '')).toBe('[LOCAL] Paperstem');
  });
});
