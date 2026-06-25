/**
 * AuthContext — Role-aware authentication context (ADR-009).
 *
 * Wraps the Auth0 user with our backend profile (global role, tenant memberships).
 * Provides:
 *   - user profile with globalRole
 *   - tenant memberships with per-tenant roles
 *   - active tenant selection (for consultant tenant switching)
 *   - can(permission) helper for conditional UI rendering
 */

"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import { useUser } from "@auth0/nextjs-auth0/client";
import { apiFetch } from "@/lib/api/client";
import {
  GlobalRole,
  TenantRole,
  UserProfile,
  TenantMembership,
  Permission,
  resolvePermissions,
} from "./types";

interface AuthContextValue {
  /** Auth0 authentication state */
  isAuthenticated: boolean;
  /** True while loading Auth0 user or backend profile */
  isLoading: boolean;
  /** User profile from our backend (global role, etc.) */
  user: UserProfile | null;
  /** Tenant memberships with per-tenant roles */
  tenants: TenantMembership[];
  /** Currently active tenant (for consultant context switching) */
  activeTenant: TenantMembership | null;
  /** Switch the active tenant context */
  setActiveTenantId: (id: string | null) => void;
  /** Check if the user has a specific permission */
  can: (permission: Permission) => boolean;
  /** Global role shortcut */
  globalRole: GlobalRole;
  /** True if user has no tenant access (needs invitation) */
  hasNoAccess: boolean;
  /** Refetch the backend profile */
  refresh: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  isAuthenticated: false,
  isLoading: true,
  user: null,
  tenants: [],
  activeTenant: null,
  setActiveTenantId: () => {},
  can: () => false,
  globalRole: "viewer",
  hasNoAccess: false,
  refresh: () => {},
});

const ACTIVE_TENANT_KEY = "dd_active_tenant";

export function AuthContextProvider({ children }: { children: React.ReactNode }) {
  const { user: auth0User, isLoading: auth0Loading } = useUser();
  const [backendProfile, setBackendProfile] = useState<UserProfile | null>(null);
  const [tenants, setTenants] = useState<TenantMembership[]>([]);
  const [profileLoading, setProfileLoading] = useState(false);
  const [activeTenantId, setActiveTenantIdState] = useState<string | null>(null);

  // Fetch backend profile when Auth0 user is available
  const fetchProfile = useCallback(async () => {
    if (!auth0User) {
      setBackendProfile(null);
      setTenants([]);
      return;
    }

    setProfileLoading(true);
    try {
      const data = await apiFetch<{
        user: UserProfile;
        tenants: TenantMembership[];
      }>("/me");

      // Sync Auth0 profile to backend if fields are missing
      const needsSync =
        (!data.user.email && auth0User.email) ||
        (!data.user.displayName && auth0User.name) ||
        (!data.user.avatarUrl && auth0User.picture);

      if (needsSync) {
        const syncData: Record<string, string> = {};
        if (!data.user.email && auth0User.email) syncData.email = auth0User.email;
        if (!data.user.displayName && auth0User.name) syncData.displayName = auth0User.name;
        if (!data.user.avatarUrl && auth0User.picture) syncData.avatarUrl = auth0User.picture;

        const updated = await apiFetch<{ user: UserProfile; tenants: TenantMembership[] }>("/me", {
          method: "PATCH",
          body: JSON.stringify(syncData),
        });
        setBackendProfile(updated.user);
        setTenants(updated.tenants);
      } else {
        setBackendProfile(data.user);
        setTenants(data.tenants);
      }

      // Restore active tenant from localStorage, or default to first tenant
      const stored = localStorage.getItem(ACTIVE_TENANT_KEY);
      if (stored && data.tenants.some((t) => t.id === stored)) {
        setActiveTenantIdState(stored);
      } else if (data.tenants.length === 1) {
        // Auto-select if only one tenant
        setActiveTenantIdState(data.tenants[0].id);
      }
    } catch (err) {
      console.error("Failed to fetch user profile:", err);
    } finally {
      setProfileLoading(false);
    }
  }, [auth0User]);

  useEffect(() => {
    if (auth0User && !auth0Loading) {
      fetchProfile();
    }
  }, [auth0User, auth0Loading, fetchProfile]);

  // Persist active tenant selection
  const setActiveTenantId = useCallback((id: string | null) => {
    setActiveTenantIdState(id);
    if (id) {
      localStorage.setItem(ACTIVE_TENANT_KEY, id);
    } else {
      localStorage.removeItem(ACTIVE_TENANT_KEY);
    }
  }, []);

  const activeTenant = useMemo(
    () => tenants.find((t) => t.id === activeTenantId) ?? null,
    [tenants, activeTenantId]
  );

  const globalRole: GlobalRole = backendProfile?.globalRole ?? "viewer";

  // Resolve permissions based on global role + active tenant role
  const permissions = useMemo(
    () => resolvePermissions(globalRole, activeTenant?.tenantRole),
    [globalRole, activeTenant?.tenantRole]
  );

  const can = useCallback(
    (permission: Permission) => permissions.has(permission),
    [permissions]
  );

  const isAuthenticated = !!auth0User;
  const isLoading = auth0Loading || profileLoading;
  const hasNoAccess =
    isAuthenticated &&
    !isLoading &&
    backendProfile !== null &&
    tenants.length === 0 &&
    globalRole !== "system_admin" &&
    globalRole !== "consultant";

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated,
      isLoading,
      user: backendProfile,
      tenants,
      activeTenant,
      setActiveTenantId,
      can,
      globalRole,
      hasNoAccess,
      refresh: fetchProfile,
    }),
    [isAuthenticated, isLoading, backendProfile, tenants, activeTenant, setActiveTenantId, can, globalRole, hasNoAccess, fetchProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
