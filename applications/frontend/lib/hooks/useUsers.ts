'use client';

import useSWR from 'swr';
import { apiFetch, buildQueryString } from '@/lib/api/client';

export interface UserSummary {
  id: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  globalRole: string;
  lastLoginAt: string | null;
  createdAt: string | null;
  tenantCount: number;
}

export interface UserDetail extends UserSummary {
  auth0Sub: string;
  tenants: {
    tenantId: string;
    tenantName: string;
    tenantRole: string;
    joinedAt: string | null;
  }[];
}

export interface PageInfo {
  totalItems: number;
  totalPages: number;
  currentPage: number;
  pageSize: number;
}

const fetcher = (url: string) => apiFetch<any>(url);

export function useUsers(params?: { page?: number; pageSize?: number; role?: string; search?: string }) {
  const qs = buildQueryString(params ?? {});
  const { data, error, isLoading, mutate } = useSWR(`/users${qs}`, fetcher);

  return {
    users: (data?.users ?? []) as UserSummary[],
    page: data?.page as PageInfo | undefined,
    isLoading,
    error,
    mutate,
  };
}

export function useUser(id: string | null) {
  const { data, error, isLoading, mutate } = useSWR(
    id ? `/users/${id}` : null,
    fetcher
  );

  return {
    user: data?.user as UserDetail | undefined,
    isLoading,
    error,
    mutate,
  };
}

export async function updateUserRole(userId: string, globalRole: string) {
  return apiFetch<{ user: UserSummary }>(`/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ globalRole }),
  });
}

export async function deleteUser(userId: string) {
  return apiFetch<{ message: string }>(`/users/${userId}`, {
    method: 'DELETE',
  });
}
