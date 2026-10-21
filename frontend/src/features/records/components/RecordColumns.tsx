import { Link } from 'react-router-dom';
import type { Column } from '@/components/data-display';
import { humaniseAttcode } from './FieldControls';
import { listCell } from '../lib/list-cells';
import type { ClassInfo, RecordDto } from '../types';

/**
 * The columns of a records list: the id, linked to the record, then one per
 * attribute, pickers shown by name and linked to what they point at.
 */
export function recordColumns(className: string, info: ClassInfo | undefined, columns: string[]): Column<RecordDto>[] {
  const cells: Column<RecordDto>[] = columns.map((attcode) => ({
    id: attcode,
    header: info?.labels?.fields?.[attcode] ?? humaniseAttcode(attcode),
    enableSorting: false,
    cell: ({ row }) => {
      if (!info) return null;
      const { text, to } = listCell(info, attcode, row.original.fields);
      return to ? (
        <Link
          to={to}
          onClick={(e) => e.stopPropagation()}
          className="block truncate text-ink transition-colors hover:text-brand-ink hover:underline"
          title={text}
        >
          {text}
        </Link>
      ) : (
        <span className="block truncate text-ink" title={text}>
          {text}
        </span>
      );
    },
  }));

  return [
    {
      id: 'id',
      header: 'ID',
      size: 80,
      enableSorting: false,
      cell: ({ row }) => (
        <Link
          to={`/records/${className}/${row.original.id}`}
          onClick={(e) => e.stopPropagation()}
          className="font-medium whitespace-nowrap text-brand-ink transition-colors hover:underline"
        >
          #{row.original.id}
        </Link>
      ),
    },
    ...cells,
  ];
}
