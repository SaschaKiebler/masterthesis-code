'use client';

import useSWR from 'swr';
import { apiFetch, buildQueryString } from '@/lib/api/client';

export interface TenantSummary {
  id: string;
  name: string;
  type: string;
  status: string;
  createdBy: string | null;
  createdAt: string | null;
}

export interface TenantMember {
  userId: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  globalRole: string;
  tenantRole: string;
  joinedAt: string | null;
}

export interface TenantDetail {
  tenant: TenantSummary;
  members?: TenantMember[];
}

const fetcher = (url: string) => apiFetch<any>(url);

export function useTenants() {
  const { data, error, isLoading, mutate } = useSWR('/tenants', fetcher);

  return {
    tenants: (data?.tenants ?? []) as TenantSummary[],
    isLoading,
    error,
    mutate,
  };
}

export function useTenant(id: string | null) {
  const { data, error, isLoading, mutate } = useSWR(
    id ? `/tenants/${id}` : null,
    fetcher
  );

  return {
    tenant: data?.tenant as TenantSummary | undefined,
    members: (data?.members ?? []) as TenantMember[],
    isLoading,
    error,
    mutate,
  };
}

export function useTenantMembers(tenantId: string | null) {
  const { data, error, isLoading, mutate } = useSWR(
    tenantId ? `/tenants/${tenantId}/members` : null,
    fetcher
  );

  return {
    members: (data?.members ?? []) as TenantMember[],
    isLoading,
    error,
    mutate,
  };
}

export async function createTenant(body: { name: string; type?: string }) {
  return apiFetch<{ tenant: TenantSummary }>('/tenants', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function updateTenant(id: string, body: Record<string, any>) {
  return apiFetch<{ tenant: TenantSummary }>(`/tenants/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function addTenantMember(tenantId: string, body: { userId: string; tenantRole: string }) {
  return apiFetch<{ member: TenantMember }>(`/tenants/${tenantId}/members`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function updateTenantMemberRole(tenantId: string, userId: string, tenantRole: string) {
  return apiFetch<{ member: TenantMember }>(`/tenants/${tenantId}/members/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ tenantRole }),
  });
}

export async function removeTenantMember(tenantId: string, userId: string) {
  return apiFetch<{ message: string }>(`/tenants/${tenantId}/members/${userId}`, {
    method: 'DELETE',
  });
}

export interface CreateTenantWithInvitationRequest {
  name: string;
  consultantEmail: string;
  consultantTenantRole?: string;
  consultantGlobalRole?: string;
  type?: string;
}

export interface CreateTenantWithInvitationResponse {
  tenant: TenantSummary;
  invitation: {
    id: string;
    email: string;
    token: string;
    expiresAt: string;
  };
}

export async function createTenantWithInvitation(body: CreateTenantWithInvitationRequest) {
  return apiFetch<CreateTenantWithInvitationResponse>('/tenants/with-invitation', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
