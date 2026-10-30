import { http, HttpResponse } from 'msw';
import { env } from '@/config/env';
import type { Criterion, RecordDto } from '@/features/records/types';
import { classInfos, classList, navigation, records } from '../fixtures/records';
import { applyIncidentStimulus, incidentRecord } from './incidents';

const url = (path: string) => `${env.bffUrl}${path}`;

const notFound = (message: string) =>
  HttpResponse.json({ error: { code: 'not_found', message } }, { status: 404 });

/**
 * One advanced-search condition, applied for real so the mock exercises the
 * same round trip the BFF does (criteria in the URL, a narrower list back).
 */
function matches(record: RecordDto, c: Criterion): boolean {
  const value = String(record.fields[c.field] ?? '');
  const lower = value.toLowerCase();
  const wanted = (c.value ?? '').toLowerCase();
  switch (c.op) {
    case 'contains':
      return lower.includes(wanted);
    case 'not_contains':
      return !lower.includes(wanted);
    case 'starts_with':
      return lower.startsWith(wanted);
    case 'ends_with':
      return lower.endsWith(wanted);
    case 'equals':
      return lower === wanted;
    case 'not_equals':
      return lower !== wanted;
    case 'in':
      return (c.values ?? []).includes(value);
    case 'not_in':
      return !(c.values ?? []).includes(value);
    case 'empty':
      return value === '' || value === '0';
    case 'not_empty':
      return value !== '' && value !== '0';
    default:
      return true;
  }
}

/** The generic record screens (`/records/*`): schema, lists, one record, lookups. */
export const recordHandlers = [
  http.get(url('/meta/navigation'), () => HttpResponse.json(navigation)),
  http.get(url('/meta/classes'), () => HttpResponse.json(classList)),
  http.get(url('/meta/classes/:className'), ({ params }) => {
    const info = classInfos[String(params.className)];
    return info ? HttpResponse.json(info) : notFound(`Unknown class ${String(params.className)}.`);
  }),
  http.get(url('/meta/classes/:className/fields/:attcode/options'), ({ params }) => {
    const target = classInfos[String(params.className)]?.fields[String(params.attcode)]?.target ?? '';
    const options = (records[target] ?? []).map((r) => ({ id: r.id, label: r.label }));
    return HttpResponse.json({ options, total: options.length, truncated: false });
  }),
  http.get(url('/lookups/:className'), ({ params, request }) => {
    const q = new URL(request.url).searchParams.get('q')?.toLowerCase() ?? '';
    const options = (records[String(params.className)] ?? [])
      .filter((r) => r.label.toLowerCase().includes(q))
      .map((r) => ({ id: r.id, label: r.label }));
    return HttpResponse.json({ options, total: options.length, truncated: false });
  }),

  http.get(url('/objects/:className'), ({ params, request }) => {
    const search = new URL(request.url).searchParams;
    const page = Number(search.get('page')) || 1;
    const limit = Number(search.get('limit')) || 25;
    const q = search.get('q')?.toLowerCase();
    let criteria: Criterion[] = [];
    try {
      criteria = JSON.parse(search.get('criteria') ?? '[]') as Criterion[];
    } catch {
      return HttpResponse.json({ error: { code: 'bad_request', message: 'criteria is not JSON.' } }, { status: 400 });
    }
    let items = records[String(params.className)] ?? [];
    if (q) items = items.filter((r) => r.label.toLowerCase().includes(q));
    items = items.filter((r) => criteria.every((c) => matches(r, c)));
    const total = items.length;
    return HttpResponse.json({
      items: items.slice((page - 1) * limit, page * limit),
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
      hasMore: page * limit < total,
      sortedInBff: false,
    });
  }),
  http.get(url('/objects/:className/:id'), ({ params }) => {
    const record =
      params.className === 'Incident'
        ? incidentRecord(params.id)
        : (records[String(params.className)] ?? []).find((r) => r.id === Number(params.id));
    return record ? HttpResponse.json(record) : notFound(`${String(params.className)} ${String(params.id)} was not found.`);
  }),
  http.post(url('/objects/:className/:id/stimulus'), async ({ params, request }) => {
    if (params.className !== 'Incident') return notFound(`No lifecycle mocked for ${String(params.className)}.`);
    const body = (await request.json()) as { stimulus: string; fields?: Record<string, unknown> };
    const object = applyIncidentStimulus(params.id, body.stimulus, body.fields ?? {});
    return object
      ? HttpResponse.json({ object })
      : HttpResponse.json(
          { error: { code: 'bad_request', message: `"${body.stimulus}" is not available on Incident ${String(params.id)}.` } },
          { status: 400 },
        );
  }),
  http.get(url('/objects/:className/:id/history'), () =>
    HttpResponse.json({ items: [], total: 0, truncated: false }),
  ),
];
