import { beforeAll, describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { configure, renderWithProviders, screen, within } from '@/test/render';
import { DataImportPage } from './DataImportPage';
import { SyncSourcesPage } from './SyncSourcesPage';

// Each step waits on a mock request, which can pass a second on a busy machine.
beforeAll(() => configure({ asyncUtilTimeout: 10_000 }));

describe('DataImportPage', () => {
  it('uploads, maps, previews and runs, then keeps the report', async () => {
    const user = userEvent.setup({ delay: null });
    renderWithProviders(<DataImportPage />);

    await user.selectOptions(await screen.findByLabelText('Records to load'), 'Organization');
    const file = new File(['Name,Code,Parent\nAcme,AC,\nexisting Globex,GX,Acme\n,ZZ,\n'], 'orgs.csv', { type: 'text/csv' });
    await user.upload(screen.getByLabelText('File to import'), file);

    expect(await screen.findByText(/orgs\.csv · 3 rows · 3 columns/)).toBeInTheDocument();
    // Mapped from the headings; a reference by name; the class's key ticked.
    expect(await screen.findByLabelText('Field for column Parent')).toHaveValue('parent_id->name');
    expect(screen.getByRole('checkbox', { name: 'name' })).toBeChecked();
    expect(screen.getByRole('button', { name: /Run import/ })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText('Preview — nothing written yet')).toBeInTheDocument();
    expect(screen.getByText('1 to create')).toBeInTheDocument();
    expect(screen.getByText('1 to update')).toBeInTheDocument();
    expect(screen.getByText('The key column "name" is empty.')).toBeInTheDocument();
    expect(screen.getByText(/2 records will be written; 1 row with errors will be skipped/)).toBeInTheDocument();

    // Changing the keys makes the preview stale.
    await user.click(screen.getByRole('checkbox', { name: 'code' }));
    expect(screen.queryByText('Preview — nothing written yet')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByText('Preview — nothing written yet');

    await user.click(screen.getByRole('button', { name: /Run import/ }));
    expect(await screen.findByText('Import finished')).toBeInTheDocument();
    expect(screen.getByText('1 created')).toBeInTheDocument();
    const recent = await screen.findByRole('list', { name: 'Recent imports' });
    expect(within(recent).getByText('Organization · orgs.csv')).toBeInTheDocument();
  }, 45_000);
});

describe('SyncSourcesPage', () => {
  it('defines a source with its keys and delete policy', async () => {
    const user = userEvent.setup({ delay: null });
    renderWithProviders(<SyncSourcesPage />);
    expect(await screen.findByText('No sync sources yet')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /New source/ }));
    await user.type(screen.getByLabelText('Source name'), 'HR feed');
    await user.selectOptions(screen.getByLabelText('Target class'), 'Organization');
    await user.click(await screen.findByLabelText('name in the feed'));
    await user.click(screen.getByLabelText('Match on name'));
    await user.click(screen.getByLabelText('parent_id in the feed'));
    expect(screen.getByLabelText('parent_id given by')).toHaveValue('name');
    await user.selectOptions(screen.getByLabelText('When a record leaves the feed'), 'update');
    expect(screen.getByLabelText('Fields to set')).toHaveValue('status:obsolete');
    await user.click(screen.getByRole('button', { name: 'Create source' }));

    // Saved; the list shows it.
    expect(await screen.findByRole('link', { name: 'HR feed' })).toBeInTheDocument();
  }, 45_000);
});
