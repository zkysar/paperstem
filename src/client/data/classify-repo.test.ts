import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { postClassify, postSectionFingerprint } from './classify-repo';

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('postClassify', () => {
  it('POSTs to /api/projects/:id/classify with credentials and returns the parsed body', async () => {
    const body = {
      run_id: 'r-1',
      reused: false,
      sections: [],
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse(200, body),
    );
    const out = await postClassify('p-1', {
      segments: [],
      audio_hash: 'h',
      classifier_version: 'yamnet-v1',
      fingerprint_version: 1,
      source_surface: 'web',
    });
    expect(out).toEqual(body);
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe('/api/projects/p-1/classify');
    expect(call[1].method).toBe('POST');
    expect(call[1].credentials).toBe('include');
  });

  it('throws on non-2xx with the server error', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse(400, { error: 'invalid_input' }),
    );
    await expect(() =>
      postClassify('p-1', {
        segments: [],
        audio_hash: 'h',
        classifier_version: 'yamnet-v1',
        fingerprint_version: 1,
        source_surface: 'web',
      }),
    ).rejects.toThrow('invalid_input');
  });
});

describe('postSectionFingerprint', () => {
  it('returns {ok:true} on 200', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse(200, {}),
    );
    const out = await postSectionFingerprint('p-1', 's-1', {
      chroma: [[1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
      fingerprint_version: 1,
    });
    expect(out.ok).toBe(true);
  });

  it('returns ok:false with status=404 when the endpoint is missing (Phase 4 not landed)', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse(404, { error: 'not_found' }),
    );
    const out = await postSectionFingerprint('p-1', 's-1', {
      chroma: [],
      fingerprint_version: 1,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.status).toBe(404);
  });

  it('returns ok:false on network failure without throwing', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('offline'),
    );
    const out = await postSectionFingerprint('p-1', 's-1', {
      chroma: [],
      fingerprint_version: 1,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain('offline');
  });
});
