import { HttpResponse, http } from 'msw';
import { getDb, saveDb } from '../fixtures/db';
import { cis, orgs } from '../fixtures/reference';
import type { KnownErrorRecord } from '../fixtures/seed';
import { toKnownErrorSummary } from './problems';
import { api, error, latency, matchesQuery, notFound, paginate, requireWriter } from './utils';

const DOMAINS = ['Network', 'Server', 'Application', 'Desktop'];

function toDetail(ke: KnownErrorRecord) {
  return {
    ...toKnownErrorSummary(ke),
    symptom: ke.symptom,
    root_cause: ke.root_cause,
    workaround: ke.workaround,
    solution: ke.solution,
    ci_list: ke.ci_list.map((l) => ({
      functionalci_id: l.functionalci_id,
      functionalci_name: cis.find((c) => c.id === l.functionalci_id)?.name ?? l.functionalci_id,
      reason: l.reason,
    })),
    document_list: ke.document_list,
  };
}

type Body = Partial<Omit<KnownErrorRecord, 'id' | 'created' | 'document_list'>>;

/** Returns an error response for invalid input, or null */
function validate(body: Body) {
  if (!body.name?.trim()) return error(400, 'missing_field', 'Name is mandatory.');
  if (!body.org_id || !orgs.some((o) => o.id === body.org_id)) return error(400, 'missing_field', 'Organization is mandatory.');
  if (!body.symptom?.trim()) return error(400, 'missing_field', 'Symptom is mandatory.');
  if (body.domain && !DOMAINS.includes(body.domain)) return error(400, 'invalid_value', 'Invalid domain.');
  if (body.problem_id && !getDb().problems.some((p) => p.id === body.problem_id)) {
    return error(400, 'invalid_value', 'Unknown problem.');
  }
  return null;
}

function apply(target: KnownErrorRecord, body: Body) {
  target.name = body.name!.trim();
  target.org_id = body.org_id!;
  target.problem_id = body.problem_id ?? null;
  target.symptom = body.symptom ?? '';
  target.root_cause = body.root_cause ?? '';
  target.workaround = body.workaround ?? '';
  target.solution = body.solution ?? '';
  target.error_code = body.error_code ?? '';
  target.domain = (body.domain as KnownErrorRecord['domain']) ?? 'Application';
  target.vendor = body.vendor ?? '';
  target.model = body.model ?? '';
  target.version = body.version ?? '';
  target.ci_list = (body.ci_list ?? []).filter((l) => cis.some((c) => c.id === l.functionalci_id));
}

export const knowledgeBaseHandlers = [
  http.get(api('/known-errors'), async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const q = url.searchParams.get('q');
    const domain = url.searchParams.get('domain');
    const problemId = url.searchParams.get('problemId');
    const rows = getDb()
      .knownErrors.filter(
        (ke) =>
          (!domain || ke.domain === domain) &&
          (!problemId || ke.problem_id === problemId) &&
          matchesQuery(q, ke.name, ke.error_code, ke.symptom, ke.vendor, ke.model, ke.version),
      )
      .sort((a, b) => b.created.localeCompare(a.created))
      .map(toKnownErrorSummary);
    return HttpResponse.json(paginate(rows, url));
  }),

  http.get(api('/known-errors/:id'), async ({ params }) => {
    await latency();
    const ke = getDb().knownErrors.find((k) => k.id === params.id);
    return ke ? HttpResponse.json(toDetail(ke)) : notFound('Known error', String(params.id));
  }),

  http.post(api('/known-errors'), async ({ request }) => {
    await latency();
    const { denied } = requireWriter(request);
    if (denied) return denied;
    const body = (await request.json()) as Body;
    const invalid = validate(body);
    if (invalid) return invalid;
    const db = getDb();
    db.seq.knownError += 1;
    const record = { id: String(db.seq.knownError), document_list: [], created: new Date().toISOString() } as unknown as KnownErrorRecord;
    apply(record, body);
    db.knownErrors.push(record);
    saveDb();
    return HttpResponse.json(toDetail(record), { status: 201 });
  }),

  http.patch(api('/known-errors/:id'), async ({ params, request }) => {
    await latency();
    const { denied } = requireWriter(request);
    if (denied) return denied;
    const ke = getDb().knownErrors.find((k) => k.id === params.id);
    if (!ke) return notFound('Known error', String(params.id));
    const body = { ...ke, ...((await request.json()) as Body) };
    const invalid = validate(body);
    if (invalid) return invalid;
    apply(ke, body);
    saveDb();
    return HttpResponse.json(toDetail(ke));
  }),
];
