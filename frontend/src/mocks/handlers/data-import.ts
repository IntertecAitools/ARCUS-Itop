import { http, HttpResponse } from 'msw';
import { env } from '@/config/env';
import type {
  ImportPlan,
  ImportReport,
  ImportRequest,
  SyncSourceDetail,
  SyncSourceInput,
  UploadedTable,
} from '@/features/data-import';

const DI = (path = '') => `${env.bffUrl}/admin/data-import${path}`;

/**
 * Mock data import: reads a CSV, previews every row as a create unless its
 * first column says "existing", and keeps run reports in memory. Sync
 * sources are kept in memory too (backend/src/modules/data-import).
 */
const reports: ImportReport[] = [];
const sources: SyncSourceDetail[] = [];
let nextSource = 1;

function plan(className: string, request: ImportRequest): ImportPlan {
  const columns = request.columns.filter((c): c is string => c !== null);
  const rows = request.rows.map((cells, i) => {
    const existing = (cells[0] ?? '').toLowerCase().includes('existing');
    const empty = (cells[0] ?? '').trim() === '';
    return {
      line: i + 2,
      action: empty ? ('error' as const) : existing ? ('update' as const) : ('create' as const),
      ...(existing ? { id: 100 + i } : {}),
      key: request.keys.map((k) => `${k}=${cells[request.columns.indexOf(k)] ?? ''}`).join(', '),
      changes: empty ? [] : columns.map((c) => ({ field: c, from: '', to: cells[request.columns.indexOf(c)] ?? '' })),
      errors: empty ? ['The key column "name" is empty.'] : [],
    };
  });
  const count = (a: string) => rows.filter((r) => r.action === a).length;
  return {
    className,
    columns,
    keys: request.keys,
    summary: { create: count('create'), update: count('update'), unchanged: 0, error: count('error') },
    rows,
  };
}

export const dataImportHandlers = [
  http.get(DI('/classes'), () =>
    HttpResponse.json({
      classes: [
        { name: 'Person', label: 'Person', defaultKeys: ['email'] },
        { name: 'Organization', label: 'Organization', defaultKeys: ['name'] },
        { name: 'Server', label: 'Server', defaultKeys: ['name', 'org_id->name'] },
      ],
    }),
  ),

  http.post(DI('/read'), async ({ request }) => {
    const { fileName, content } = (await request.json()) as { fileName: string; content: string };
    const lines = atob(content).split(/\r?\n/).filter(Boolean);
    const split = (line: string) => line.split(line.includes(';') ? ';' : ',');
    const table: UploadedTable = { fileName, headings: split(lines[0] ?? ''), rows: lines.slice(1).map(split) };
    return HttpResponse.json(table);
  }),

  http.post(DI('/:class/preview'), async ({ params, request }) =>
    HttpResponse.json(plan(String(params['class']), (await request.json()) as ImportRequest)),
  ),

  http.post(DI('/:class/run'), async ({ params, request }) => {
    const body = (await request.json()) as ImportRequest;
    const p = plan(String(params['class']), body);
    const now = new Date().toISOString();
    const report: ImportReport = {
      id: crypto.randomUUID(),
      className: p.className,
      fileName: body.fileName ?? '',
      startedAt: now,
      finishedAt: now,
      by: 'admin',
      summary: { created: p.summary.create, updated: p.summary.update, unchanged: 0, error: p.summary.error },
      rows: p.rows.map(({ action, ...r }) => ({
        ...r,
        outcome: action === 'create' ? 'created' : action === 'update' ? 'updated' : action === 'unchanged' ? 'unchanged' : 'error',
        ...(action === 'create' ? { id: 500 + r.line } : {}),
      })),
    };
    reports.unshift(report);
    return HttpResponse.json(report, { status: 201 });
  }),

  http.get(DI('/reports'), () => HttpResponse.json({ reports: reports.map(({ rows: _rows, ...r }) => r) })),
  http.get(DI('/reports/:id/download'), ({ params }) => {
    const report = reports.find((r) => r.id === params['id']);
    const csv = ['Line,Outcome,Record id', ...(report?.rows ?? []).map((r) => `${r.line},${r.outcome},${r.id ?? ''}`)].join('\n');
    return new HttpResponse(csv, { headers: { 'content-type': 'text/csv' } });
  }),

  http.get(DI('/sync-sources'), () => HttpResponse.json({ sources: sources.map(({ attributes: _a, logs: _l, ...s }) => s) })),
  http.post(DI('/sync-sources'), async ({ request }) => {
    const input = (await request.json()) as SyncSourceInput;
    const source: SyncSourceDetail = {
      id: nextSource++,
      name: input.name,
      description: input.description ?? '',
      status: input.status ?? 'implementation',
      targetClass: input.targetClass,
      reconciliationPolicy: 'use_attributes',
      actionOnZero: 'create',
      actionOnOne: 'update',
      actionOnMultiple: input.actionOnMultiple ?? 'error',
      deletePolicy: input.deletePolicy ?? 'ignore',
      deletePolicyUpdate: input.deletePolicyUpdate ?? '',
      deletePolicyRetention: input.deletePolicyRetention ?? 0,
      fullLoadPeriodicity: 0,
      user: 'admin',
      attributes: input.columns.map((attcode) => ({
        attcode,
        update: true,
        reconcile: input.keys.includes(attcode),
        updatePolicy: 'master_locked',
        ...(input.lookups?.[attcode] !== undefined ? { lookup: input.lookups[attcode] } : {}),
      })),
      logs: [],
    };
    sources.push(source);
    return HttpResponse.json(source, { status: 201 });
  }),
  http.get(DI('/sync-sources/:id'), ({ params }) => {
    const source = sources.find((s) => String(s.id) === params['id']);
    return source
      ? HttpResponse.json(source)
      : HttpResponse.json({ error: { code: 'not_found', message: 'Sync source was not found.' } }, { status: 404 });
  }),
  http.delete(DI('/sync-sources/:id'), ({ params }) => {
    const index = sources.findIndex((s) => String(s.id) === params['id']);
    if (index >= 0) sources.splice(index, 1);
    return HttpResponse.json({ ok: true });
  }),
  http.post(DI('/sync-sources/:id/run'), async ({ request }) => {
    const body = (await request.json()) as { rows: string[][]; simulate: boolean };
    return HttpResponse.json({
      simulated: body.simulate,
      counts: { 'Objects created': body.rows.length, 'Objects updated': 0 },
      messages: [],
    });
  }),
];
