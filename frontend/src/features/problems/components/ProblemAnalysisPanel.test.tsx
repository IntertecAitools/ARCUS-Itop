import { beforeAll, describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { configure, renderWithProviders, screen, within } from '@/test/render';
import { lastAnalysisSave } from '@/mocks/handlers/problems';
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

  it('ranks likely causes with their reasons and links', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProblemAnalysisPanel id="504" />);
    const causes = await screen.findByRole('list', { name: 'Likely causes' });
    expect(within(causes).getByText('Change C-000123 on db-01, 2h before the first incident')).toBeInTheDocument();
    expect(within(causes).getByText(/Touches db-01, named by 7 of 9 incidents/)).toBeInTheDocument();
    expect(within(causes).getByRole('link', { name: 'C-000123' })).toHaveAttribute('href', '/records/NormalChange/123');
    // A shorter look-back drops the change.
    await user.selectOptions(screen.getByLabelText('Look-back for changes'), '24');
    await user.selectOptions(screen.getByLabelText('Look-back for changes'), '168');
    expect(await screen.findByRole('list', { name: 'Likely causes' })).toBeInTheDocument();
  });

  it('fills the form with an AI draft, and saves it only on Save, marked as AI-drafted', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProblemAnalysisPanel id="505" />);
    await user.click(await screen.findByRole('button', { name: 'Draft with AI' }));

    const banner = await screen.findByRole('status', { name: 'AI draft' });
    expect(within(banner).getByText(/medium confidence/)).toBeInTheDocument();
    expect(within(banner).getByRole('link', { name: 'db-01' })).toHaveAttribute('href', '/records/DBServer/7');
    expect(within(banner).getByText(/1 email\(s\)/)).toBeInTheDocument();
    expect(screen.getByLabelText('Root cause')).toHaveValue(
      'The database engine patch in C-000123 lowered the connection limit on db-01.',
    );
    // Nothing saved yet.
    expect(lastAnalysisSave.has('505')).toBe(false);

    await user.type(screen.getByLabelText('Resolution'), ' Reviewed.');
    await user.click(screen.getByRole('button', { name: 'Save analysis' }));
    expect(await screen.findByText('Changes are recorded in the History tab.')).toBeInTheDocument();
    expect(lastAnalysisSave.get('505')).toMatchObject({
      aiDraft: { model: 'claude-opus-5-5' },
      resolution: 'Restore the connection limit and add it to the patch checklist. Reviewed.',
    });
    expect(screen.queryByRole('status', { name: 'AI draft' })).not.toBeInTheDocument();
  });

  it('offers no AI draft where the BFF has none configured', async () => {
    renderWithProviders(<ProblemAnalysisPanel id="998" />);
    expect(await screen.findByRole('list', { name: 'Likely causes' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Draft with AI' })).not.toBeInTheDocument();
  });
});
