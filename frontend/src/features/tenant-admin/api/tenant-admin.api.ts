import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { BRANDING_KEY } from '@/features/branding';
import type {
  BrandingInput,
  EmailDomain,
  OrgRow,
  PersonOption,
  TeamRow,
  TenantDetail,
  TenantList,
} from '../types';

const base = '/admin/tenants';
const key = (id: string, ...rest: string[]) => ['admin', 'tenants', id, ...rest];

export function useTenants() {
  return useQuery({ queryKey: ['admin', 'tenants'], queryFn: () => apiClient.get<TenantList>(base) });
}

export function useTenant(id: string) {
  return useQuery({ queryKey: key(id), queryFn: () => apiClient.get<TenantDetail>(`${base}/${id}`), enabled: Boolean(id) });
}

export function useTenantOrgs(id: string) {
  return useQuery({
    queryKey: key(id, 'orgs'),
    queryFn: async () => (await apiClient.get<{ items: OrgRow[] }>(`${base}/${id}/orgs`)).items,
    enabled: Boolean(id),
  });
}

export function useTenantTeams(id: string) {
  return useQuery({
    queryKey: key(id, 'teams'),
    queryFn: async () => (await apiClient.get<{ items: TeamRow[] }>(`${base}/${id}/teams`)).items,
    enabled: Boolean(id),
  });
}

export function useTenantPeople(id: string, q: string) {
  return useQuery({
    queryKey: key(id, 'people', q),
    queryFn: async () =>
      (await apiClient.get<{ items: PersonOption[] }>(`${base}/${id}/people`, { query: { q: q || undefined } })).items,
    enabled: Boolean(id) && q.trim().length > 0,
    staleTime: 30_000,
  });
}

/** Every write refreshes the tenant (and the site's branding, which may be this tenant's). */
function useTenantWrite<I, O>(id: string, write: (input: I) => Promise<O>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: write,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: key(id) });
      await queryClient.invalidateQueries({ queryKey: BRANDING_KEY });
    },
  });
}

export const useSaveBranding = (id: string) =>
  useTenantWrite(id, (input: BrandingInput) => apiClient.put<TenantDetail>(`${base}/${id}/branding`, input));

export const useSaveEmailDomains = (id: string) =>
  useTenantWrite(id, (emailDomains: EmailDomain[]) =>
    apiClient.put<TenantDetail>(`${base}/${id}/email-domains`, { emailDomains }),
  );

export const useSaveHostnames = (id: string) =>
  useTenantWrite(id, (hostnames: string[]) => apiClient.put<TenantDetail>(`${base}/${id}/hostnames`, { hostnames }));

export const useCreateOrg = (id: string) =>
  useTenantWrite(id, (input: { name: string; code?: string; parentId?: number }) =>
    apiClient.post<OrgRow>(`${base}/${id}/orgs`, input),
  );

export const useUpdateOrg = (id: string) =>
  useTenantWrite(id, ({ orgId, ...input }: { orgId: number; name?: string; code?: string; status?: OrgRow['status'] }) =>
    apiClient.patch<OrgRow>(`${base}/${id}/orgs/${orgId}`, input),
  );

export const useCreateTeam = (id: string) =>
  useTenantWrite(id, (input: { name: string; orgId: number; email?: string }) =>
    apiClient.post<TeamRow>(`${base}/${id}/teams`, input),
  );

export const useUpdateTeam = (id: string) =>
  useTenantWrite(
    id,
    ({ teamId, ...input }: { teamId: number; name?: string; email?: string; status?: TeamRow['status']; memberIds?: number[] }) =>
      apiClient.patch<TeamRow>(`${base}/${id}/teams/${teamId}`, input),
  );
