import { http, HttpResponse } from 'msw';
import { env } from '@/config/env';
import type { FormField, FormScope, RequestFormDetail } from '@/features/request-forms/types';

const url = (path: string) => `${env.bffUrl}${path}`;

/**
 * Request forms for the portal's mock catalogue (portal.ts): Hardware asks
 * which device and by when; its "Laptop" subcategory adds a question.
 */
const names: Record<string, string> = {
  'service:1': 'Network access',
  'service:2': 'Hardware',
  'subcategory:11': 'Network access / VPN',
  'subcategory:12': 'Network access / Wi-Fi',
};
const forms: Record<string, FormField[]> = {
  'service:2': [
    { key: 'device', label: 'Device', type: 'choice', required: true, options: ['Laptop', 'Monitor', 'Keyboard'] },
    { key: 'needed_by', label: 'Needed by', type: 'date', required: false, help: 'Leave empty if there is no deadline.' },
  ],
};

/** The questions for a catalogue item, the way the BFF merges them. */
export function mockFormFor(serviceId?: number, subcategoryId?: number): FormField[] {
  const service = serviceId ? (forms[`service:${serviceId}`] ?? []) : [];
  const sub = subcategoryId ? (forms[`subcategory:${subcategoryId}`] ?? []) : [];
  return [...service.filter((f) => !sub.some((s) => s.key === f.key)), ...sub];
}

/** A description with the answers appended, as the BFF writes it (HTML, like iTop stores it). */
export function mockDescribe(description: string, fields: FormField[], answers: Record<string, string> = {}) {
  const items = fields
    .filter((f) => answers[f.key]?.trim())
    .map((f) => `<li><strong>${f.label}:</strong> ${answers[f.key]!.trim()}</li>`);
  return items.length
    ? `<p>${description}</p><p><strong>Request details</strong></p><ul>${items.join('')}</ul>`
    : description;
}

const detail = (scope: FormScope, id: number): RequestFormDetail => ({
  scope,
  targetId: id,
  targetName: names[`${scope}:${id}`] ?? `${scope} ${id}`,
  inherited: scope === 'subcategory' ? (forms[`service:${String(id).slice(0, 1)}`] ?? []) : [],
  fields: forms[`${scope}:${id}`] ?? [],
  updatedAt: '',
  updatedBy: '',
});

const target = (request: Request) => {
  const q = new URL(request.url).searchParams;
  return [Number(q.get('serviceId')) || undefined, Number(q.get('subcategoryId')) || undefined] as const;
};

export const requestFormHandlers = [
  http.get(url('/request-forms/resolve'), ({ request }) => HttpResponse.json({ fields: mockFormFor(...target(request)) })),
  http.get(url('/portal/request-form'), ({ request }) => HttpResponse.json({ fields: mockFormFor(...target(request)) })),
  http.get(url('/admin/request-forms'), () =>
    HttpResponse.json({
      services: [
        {
          id: 1,
          name: 'Network access',
          family: 'IT services',
          fieldCount: 0,
          subcategories: [
            { id: 11, name: 'VPN', fieldCount: 0 },
            { id: 12, name: 'Wi-Fi', fieldCount: 0 },
          ],
        },
        { id: 2, name: 'Hardware', family: 'IT services', fieldCount: (forms['service:2'] ?? []).length, subcategories: [] },
      ],
    }),
  ),
  http.get(url('/admin/request-forms/:scope/:id'), ({ params }) =>
    HttpResponse.json(detail(params.scope === 'subcategory' ? 'subcategory' : 'service', Number(params.id))),
  ),
  http.put(url('/admin/request-forms/:scope/:id'), async ({ params, request }) => {
    const scope: FormScope = params.scope === 'subcategory' ? 'subcategory' : 'service';
    const { fields } = (await request.json()) as { fields: FormField[] };
    forms[`${scope}:${Number(params.id)}`] = fields;
    return HttpResponse.json({ ...detail(scope, Number(params.id)), updatedAt: new Date().toISOString(), updatedBy: 'Mock Administrator' });
  }),
];
