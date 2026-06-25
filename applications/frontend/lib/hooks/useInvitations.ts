'use client';

import useSWR from 'swr';
import { apiFetch, buildQueryString } from '@/lib/api/client';

export interface InvitationSummary {
  id: string;
  email: string;
  tenantId: string | null;
  tenantRole: string;
  globalRole: string;
  invitedBy: string;
  token: string;
  status: 'pending' | 'accepted' | 'expired';
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string | null;
}

const fetcher = (url: string) => apiFetch<any>(url);

export function useInvitations(params?: { tenantId?: string; status?: string }) {
  const qs = buildQueryString(params ?? {});
  const { data, error, isLoading, mutate } = useSWR(`/invitations${qs}`, fetcher);

  return {
    invitations: (data?.invitations ?? []) as InvitationSummary[],
    isLoading,
    error,
    mutate,
  };
}

export async function createInvitation(body: {
  email: string;
  tenantId?: string;
  tenantRole?: string;
  globalRole?: string;
}) {
  return apiFetch<{ invitation: InvitationSummary }>('/invitations', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function revokeInvitation(id: string) {
  return apiFetch<{ message: string }>(`/invitations/${id}`, {
    method: 'DELETE',
  });
}
