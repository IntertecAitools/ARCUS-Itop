import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui';
import { humaniseAttcode } from './FieldControls';
import { exportableColumns, exportFields, loadExportColumns, saveExportColumns } from '../lib/export-columns';
import type { ClassInfo, ExportFormat } from '../types';

const EXPORT_LABELS = { csv: 'CSV', xlsx: 'Excel', pdf: 'PDF' } as const;

/**
 * Export a list as shown — every page of it — in a format iTop renders
 * itself, with the columns the user picks. They start as the list's own
 * columns; the last choice per class is remembered. What is exported (a
 * records list, a saved query) is the caller's: `onExport` gets the format
 * and iTop's `fields` for the chosen columns.
 */
export function ExportMenu({
  info,
  listColumns,
  onExport,
  pending,
  error,
}: {
  info: ClassInfo;
  listColumns: string[];
  onExport: (format: ExportFormat, fields: string) => void;
  pending: boolean;
  error?: string;
}) {
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);

  const defaults = useMemo(() => ['id', ...listColumns.filter((c) => c !== 'id')], [listColumns]);
  const available = useMemo(() => exportableColumns(info), [info]);
  const [chosen, setChosen] = useState<string[]>(() => loadExportColumns(info) ?? defaults);
  // Another class, or its schema arriving: start again from what is stored.
  useEffect(() => setChosen(loadExportColumns(info) ?? defaults), [info, defaults]);

  const label = (code: string) => (code === 'id' ? 'ID' : (info.labels?.fields?.[code] ?? humaniseAttcode(code)));
  const choose = (next: string[]) => {
    setChosen(next);
    saveExportColumns(info.name, next);
  };
  const toggle = (code: string) =>
    choose(chosen.includes(code) ? chosen.filter((c) => c !== code) : [...chosen, code]);

  return (
    <div className="relative">
      <Button
        variant="secondary"
        size="sm"
        leadingIcon={<Download className="size-4" />}
        loading={pending}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        Export
      </Button>
      {open ? (
        <div
          role="dialog"
          aria-label="Export"
          className="absolute end-0 z-20 mt-1 w-72 rounded-card border border-line bg-surface-raised py-1 shadow-overlay"
        >
          {(Object.keys(EXPORT_LABELS) as Array<keyof typeof EXPORT_LABELS>).map((format) => (
            <button
              key={format}
              type="button"
              disabled={chosen.length === 0}
              className="block w-full px-3 py-1.5 text-start text-[13px] text-ink hover:bg-surface-hover disabled:text-ink-muted"
              onClick={() => {
                setOpen(false);
                setPicking(false);
                onExport(format, exportFields(info, chosen));
              }}
            >
              {EXPORT_LABELS[format]}
            </button>
          ))}
          <div className="mt-1 border-t border-line px-3 pt-2 pb-1">
            <button
              type="button"
              className="flex w-full items-center justify-between text-start text-[12px] text-ink-secondary hover:text-ink"
              aria-expanded={picking}
              onClick={() => setPicking((p) => !p)}
            >
              <span>
                Columns: {chosen.length} of {available.length}
              </span>
              <span className="text-brand-ink">{picking ? 'Done' : 'Choose…'}</span>
            </button>
            {picking ? (
              <>
                <div className="mt-2 flex gap-3 text-[12px]">
                  <button type="button" className="text-brand-ink hover:underline" onClick={() => choose(defaults)}>
                    List columns
                  </button>
                  <button type="button" className="text-brand-ink hover:underline" onClick={() => choose(available)}>
                    All
                  </button>
                  <button type="button" className="text-brand-ink hover:underline" onClick={() => choose([])}>
                    None
                  </button>
                </div>
                <div className="mt-2 max-h-64 space-y-1 overflow-y-auto pe-1">
                  {available.map((code) => (
                    <label key={code} className="flex items-center gap-2 text-[13px] text-ink">
                      <input type="checkbox" checked={chosen.includes(code)} onChange={() => toggle(code)} />
                      <span className="truncate" title={code}>
                        {label(code)}
                      </span>
                    </label>
                  ))}
                </div>
                {chosen.length === 0 ? (
                  <p className="mt-1 text-[12px] text-critical-ink">Pick at least one column.</p>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="absolute end-0 mt-1 w-72 text-end text-[12px] text-critical-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}
