import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { configure, renderWithProviders, screen, within } from '@/test/render';
import { LicencePage } from './LicencePage';

beforeAll(() => configure({ asyncUtilTimeout: 10_000 }));
beforeEach(() => sessionStorage.clear());

const KEY = '-----BEGIN ARCUS LICENCE-----\neyJh\n.\nc2ln\n-----END ARCUS LICENCE-----';

describe('LicencePage', () => {
  it('shows what was bought and the usage against every limit', async () => {
    renderWithProviders(<LicencePage />);
    const summary = await screen.findByTestId('licence-summary');
    expect(within(summary).getByText('Example Co')).toBeInTheDocument();
    expect(within(summary).getByText('Professional')).toBeInTheDocument();
    expect(within(summary).getByText('ARC-2026-000123')).toBeInTheDocument();
    const usage = screen.getByTestId('licence-usage');
    expect(within(usage).getByText('52 of 60 · 87%')).toBeInTheDocument();
    expect(within(usage).getByText('18.4 (not limited)')).toBeInTheDocument();
    expect(screen.getByText('Key installed')).toBeInTheDocument();
  });

  it('checks a key, shows what changes, and installs it only with the EULA accepted', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LicencePage />);
    await user.click(await screen.findByLabelText('Licence'));
    await user.paste(KEY);
    await user.click(screen.getByRole('button', { name: 'Check' }));
    const changes = await screen.findByTestId('licence-changes');
    expect(within(changes).getByText('Agents 60 → 80')).toBeInTheDocument();
    expect(screen.getByTestId('eula-text')).toHaveTextContent('ARCUS END-USER LICENCE AGREEMENT');
    const install = screen.getByRole('button', { name: 'Install licence' });
    expect(install).toBeDisabled();
    await user.click(screen.getByLabelText('I accept the end-user licence agreement'));
    await user.click(install);
    expect(await screen.findByText('Installed. It applies now.')).toBeInTheDocument();
  });

  it('says why a key is refused, and saves nothing', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LicencePage />);
    await user.click(await screen.findByLabelText('Licence'));
    await user.paste('not a licence at all, just text');
    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText(/Not installed: This is not a licence file/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install licence' })).not.toBeInTheDocument();
  });
});
