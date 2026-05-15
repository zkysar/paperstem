import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { AutoClassifyToast } from './AutoClassifyToast';

describe('AutoClassifyToast', () => {
  it('renders the count and copy', () => {
    render(<AutoClassifyToast count={5} onDismiss={() => {}} />);
    expect(screen.getByText('5 sections detected.')).not.toBeNull();
  });

  it('singularizes the section count', () => {
    render(<AutoClassifyToast count={1} onDismiss={() => {}} />);
    expect(screen.getByText('1 section detected.')).not.toBeNull();
  });

  it('calls onDismiss when the close button is clicked', async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    render(<AutoClassifyToast count={3} onDismiss={onDismiss} />);
    await user.click(screen.getByLabelText('Dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
