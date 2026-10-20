import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, screen, within } from '@/test/render';
import type { ClassInfo } from '../types';
import { RecordImportPage } from './RecordImportPage';
import { RecordListPage } from './RecordListPage';

/** Enough of UserRequest for the list, export and import screens. */
const info = {
  name: 'UserRequest',
  isCi: false,
  abstract: false,
  lifecycle: null,
  presentation: { list: ['ref', 'title', 'org_id'] },
  writable: ['title', 'org_id', 'urgency'],
  readonly: ['ref'],
  fields: {
    ref: { type: 'String', ui: 'readonly' },
    title: { type: 'String', ui: 'scalar' },
    org_id: { type: 'ExternalKey', ui: 'picker', target: 'Organization' },
    urgency: { type: 'Enum', ui: 'scalar' },
  },
  labels: {
    class: 'User Request',
    fields: { ref: 'Ref', title: 'Title', org_id: 'Organization', urgency: 'Urgency' },
    values: {},
  },
} as unknown as ClassInfo;

// Many clicks each; under a full parallel run they outlast the 5 s default.
const SLOW = 30_000;

const importMutate = vi.fn();
const exportMutate = vi.fn();

vi.mock('../api/useRecords', () => ({
  useClassInfo: () => ({ data: info, isLoading: false, isError: false }),
  useImport: () => ({ mutate: importMutate, reset: vi.fn(), isPending: false, isError: false }),
  useExport: () => ({ mutate: exportMutate, isPending: false, isError: false }),
  useRecords: () => ({ data: { items: [], total: 0, page: 1, pages: 1 }, isLoading: false, isError: false }),
  useBulk: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false }),
}));

vi.mock('@/features/navigation', () => ({ useNavigation: () => ({ data: undefined }) }));

beforeEach(() => {
  importMutate.mockReset();
  exportMutate.mockReset();
  window.localStorage.clear();
});

const at = (path: string, element: React.ReactElement, route: string) =>
  renderWithProviders(
    <Routes>
      <Route path={path} element={element} />
    </Routes>,
    { route },
  );

describe('record list heading', () => {
  it('shows the class label, not its code', () => {
    at('/records/:className', <RecordListPage />, '/records/UserRequest');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('User Request');
  }, SLOW);
});

describe('export columns', () => {
  it('exports the list columns by default, then the picked ones, and remembers them', async () => {
    const user = userEvent.setup();
    at('/records/:className', <RecordListPage />, '/records/UserRequest');

    await user.click(screen.getByRole('button', { name: /export/i }));
    await user.click(screen.getByRole('button', { name: 'CSV' }));
    expect(exportMutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ format: 'csv', fields: 'id,ref,title,org_id_friendlyname' }),
    );

    await user.click(screen.getByRole('button', { name: /export/i }));
    await user.click(screen.getByRole('button', { name: /choose/i }));
    const dialog = screen.getByRole('dialog', { name: 'Export' });
    await user.click(within(dialog).getByRole('checkbox', { name: 'Ref' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'Urgency' }));
    await user.click(within(dialog).getByRole('button', { name: 'Excel' }));
    expect(exportMutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ format: 'xlsx', fields: 'id,title,org_id_friendlyname,urgency' }),
    );
    expect(JSON.parse(window.localStorage.getItem('records.export-columns.UserRequest') ?? '[]')).toEqual([
      'id',
      'title',
      'org_id',
      'urgency',
    ]);
  }, SLOW);
});

describe('import mapping', () => {
  it('maps label headings, lets a column be skipped, and checks the file with the mapping', async () => {
    const user = userEvent.setup();
    at('/records/:className/import', <RecordImportPage />, '/records/UserRequest/import');

    const csv = 'Title,Organization,Notes\nPrinter jam,My Company/Department,x\n';
    await user.click(screen.getByPlaceholderText(/paste csv/i));
    await user.paste(csv);

    expect(screen.getByRole('heading', { name: 'Map columns' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Field for column Title' })).toHaveValue('title');
    expect(screen.getByRole('combobox', { name: 'Field for column Organization' })).toHaveValue(
      'org_id->friendlyname',
    );
    const notes = screen.getByRole('combobox', { name: 'Field for column Notes' });
    expect(notes).toHaveValue('');

    // Map Notes onto Title: Title's own column is freed, as a field takes one column.
    await user.selectOptions(notes, 'title');
    expect(screen.getByRole('combobox', { name: 'Field for column Title' })).toHaveValue('');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Field for column Title' }), 'title');
    expect(notes).toHaveValue('');

    await user.click(screen.getByRole('checkbox', { name: 'title' }));
    await user.click(screen.getByRole('button', { name: 'Check file' }));
    expect(importMutate).toHaveBeenCalledWith(
      {
        csv,
        simulate: true,
        separator: ',',
        reconciliationKeys: ['title'],
        mapping: ['title', 'org_id->friendlyname', null],
      },
      expect.anything(),
    );
  }, SLOW);

  it('sends a file whose headings are field codes as it is', async () => {
    const user = userEvent.setup();
    at('/records/:className/import', <RecordImportPage />, '/records/UserRequest/import');
    await user.click(screen.getByPlaceholderText(/paste csv/i));
    await user.paste('title,org_id\nx,1\n');

    expect(screen.queryByRole('heading', { name: 'Map columns' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check file' }));
    expect(importMutate.mock.calls[0]?.[0]).not.toHaveProperty('mapping');
  }, SLOW);
});
