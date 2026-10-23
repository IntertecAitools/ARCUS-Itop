import { beforeAll, describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { configure, renderWithProviders, screen, within } from '@/test/render';
import { ProblemAnalysisPanel } from './ProblemAnalysisPanel';

// The mock store lives for the whole file, so each test uses its own problem.

// Every step waits on a mock request; with the whole suite running on a busy
// machine one can take longer than findBy's default second.
beforeAll(() => configure({ asyncUtilTimeout: 10_000 }));

describe('ProblemAnalysisPanel', () => {
  it('saves the analysis and raises a known error from it', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProblemAnalysisPanel id="501" />);

    const raise = await screen.findByRole('button', { name: 'Create known error' });
    expect(raise).toBeDisabled();
    expect(screen.getByText('Not analysed yet')).toBeInTheDocument();
    expect(screen.getByText('Record a root cause or a workaround first.')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Root cause'), 'Certificate expired on mail-01');
    await user.type(screen.getByLabelText('Workaround'), 'Restart the relay');
    // Unsaved changes: the known error would not get them.
    expect(screen.getByText(/Save the analysis first/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save analysis' }));
    expect(await screen.findByText('Changes are recorded in the History tab.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save analysis' })).toBeDisabled();
    expect(raise).toBeEnabled();

    await user.click(raise);
    const dialog = screen.getByRole('dialog', { name: 'Create known error' });
    expect(within(dialog).getByLabelText('Name')).toHaveValue('P-000501: Mail queue stalls every Monday');
    // What will be copied is shown before anything is written.
    expect(within(dialog).getByText('Certificate expired on mail-01')).toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText('Domain'), 'Server');
    await user.click(within(dialog).getByRole('button', { name: 'Create known error' }));

    const status = await screen.findByRole('status');
    expect(within(status).getByRole('link')).toHaveAttribute('href', '/records/KnownError/100');
    expect(await screen.findAllByRole('link', { name: 'P-000501: Mail queue stalls every Monday' })).toHaveLength(2);
  });

  it('says when the iTop lacks the root-cause fields, and offers nothing to save', async () => {
    renderWithProviders(<ProblemAnalysisPanel id="999" />);
    expect(await screen.findByText(/install(s)? the\s+arcus-problem-rca extension/)).toBeInTheDocument();
    expect(screen.getByLabelText('Root cause')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save analysis' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Create known error' })).toBeDisabled();
    expect(screen.getByText('Needs the root-cause fields on this iTop.')).toBeInTheDocument();
  });

  it('discards unsaved edits', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProblemAnalysisPanel id="503" />);
    await user.type(await screen.findByLabelText('Resolution'), 'Patch');
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByLabelText('Resolution')).toHaveValue('');
  });
});
