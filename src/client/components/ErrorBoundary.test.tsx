import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

function Bomb(): never {
  throw new Error('boom');
}

describe('ErrorBoundary', () => {
  it('renders children normally when no error is thrown', () => {
    render(
      <ErrorBoundary>
        <p>all good</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('all good')).not.toBeNull();
    expect(screen.queryByText(/something went wrong/i)).toBeNull();
  });

  it('renders fallback when a child throws, hides the child', () => {
    // React logs caught errors to console; suppress for this test.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    spy.mockRestore();

    expect(screen.getByText(/something went wrong/i)).not.toBeNull();
    expect(screen.queryByText('all good')).toBeNull();
  });

  it('shows the Report button when onReportBug is provided', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onReportBug = vi.fn();
    render(
      <ErrorBoundary onReportBug={onReportBug}>
        <Bomb />
      </ErrorBoundary>,
    );
    spy.mockRestore();

    expect(screen.getByRole('button', { name: /report this/i })).not.toBeNull();
  });

  it('hides the Report button when onReportBug is omitted', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    spy.mockRestore();

    expect(screen.queryByRole('button', { name: /report this/i })).toBeNull();
  });

  it('clicking Report this calls onReportBug with error details', async () => {
    const user = userEvent.setup();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onReportBug = vi.fn();
    render(
      <ErrorBoundary onReportBug={onReportBug}>
        <Bomb />
      </ErrorBoundary>,
    );
    consoleSpy.mockRestore();

    await user.click(screen.getByRole('button', { name: /report this/i }));
    expect(onReportBug).toHaveBeenCalledOnce();
    const arg = onReportBug.mock.calls[0][0] as {
      description?: string;
      errors?: { message: string }[];
    };
    expect(arg.description).toContain('[crash]');
    expect(arg.errors).toHaveLength(1);
    expect(arg.errors![0].message).toBe('boom');
  });
});
