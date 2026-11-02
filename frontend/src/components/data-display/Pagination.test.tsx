import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTable, type Column } from './DataTable';
import { Pagination, parsePageSize } from './Pagination';

describe('Pagination', () => {
  it('is not shown when the list fits on the smallest page', () => {
    const { container } = render(<Pagination page={1} pageSize={25} total={8} onPageChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('states the range and moves between pages', async () => {
    const onPageChange = vi.fn();
    render(<Pagination page={2} pageSize={25} total={60} onPageChange={onPageChange} />);

    expect(screen.getByText('Showing 26–50 of 60')).toBeInTheDocument();
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'First page' }));
    await userEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await userEvent.click(screen.getByRole('button', { name: 'Last page' }));
    expect(onPageChange.mock.calls.map(([page]) => page)).toEqual([1, 1, 3, 3]);
  });

  it('disables what leads nowhere at either end', () => {
    render(<Pagination page={1} pageSize={10} total={30} onPageChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'First page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
  });

  it('offers the page sizes only when the caller can change it', async () => {
    const onPageSizeChange = vi.fn();
    const { rerender } = render(<Pagination page={1} pageSize={25} total={60} onPageChange={() => {}} />);
    expect(screen.queryByRole('combobox', { name: 'Rows per page' })).toBeNull();

    rerender(<Pagination page={1} pageSize={25} total={60} onPageChange={() => {}} onPageSizeChange={onPageSizeChange} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Rows per page' }), '50');
    expect(onPageSizeChange).toHaveBeenCalledWith(50);
  });

  it('reads only the offered sizes from a URL', () => {
    expect(parsePageSize('50')).toBe(50);
    expect(parsePageSize('7')).toBe(25);
    expect(parsePageSize(null)).toBe(25);
  });
});

describe('DataTable paging', () => {
  type Row = { id: number; title: string };
  const columns: Column<Row>[] = [{ accessorKey: 'title', header: 'Title' }];
  const rows = (n: number, prefix = 'Row') => Array.from({ length: n }, (_, i) => ({ id: i + 1, title: `${prefix} ${i + 1}` }));

  it('pages a whole list itself', async () => {
    render(<DataTable data={rows(30)} columns={columns} />);
    expect(screen.getAllByRole('row')).toHaveLength(26); // header + 25
    expect(screen.getByText('Showing 1–25 of 30')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('Row 26')).toBeInTheDocument();
    expect(screen.queryByText('Row 1')).toBeNull();

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Rows per page' }), '10');
    expect(screen.getByText('Showing 1–10 of 30')).toBeInTheDocument();
  });

  it('goes back to the first page when the list changes', async () => {
    function Filtered() {
      const [n, setN] = useState(40);
      return (
        <>
          <button type="button" onClick={() => setN(35)}>
            Filter
          </button>
          <DataTable data={rows(n)} columns={columns} />
        </>
      );
    }
    render(<Filtered />);
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('Showing 26–40 of 40')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Filter' }));
    expect(screen.getByText('Showing 1–25 of 35')).toBeInTheDocument();
  });

  it('shows a server page as it is and hands paging to the caller', async () => {
    const onPageChange = vi.fn();
    render(
      <DataTable
        data={rows(25)}
        columns={columns}
        pagination={{ page: 1, pageSize: 25, total: 100, onPageChange }}
      />,
    );
    expect(screen.getByText('Showing 1–25 of 100')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('shows no pager when paging is turned off', () => {
    render(<DataTable data={rows(30)} columns={columns} pagination={false} />);
    expect(screen.getAllByRole('row')).toHaveLength(31);
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull();
  });
});
