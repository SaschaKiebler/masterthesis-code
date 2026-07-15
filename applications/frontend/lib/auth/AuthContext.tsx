/**
 * AuthContext — Role-aware authentication context (ADR-009).
 *
 * Local authentication: the session lives in an httpOnly cookie set at login.
 * On mount we fetch the backend profile (/me); a 401 simply means "not signed in".
 * Provides:
 *   - user profile with globalRole
 *   - tenant memberships with per-tenant roles
 *   - active tenant selection (for consultant tenant switching)
 *   - can(permission) helper for conditional UI rendering
 */

"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import {
  GlobalRole,
  TenantRole,
  UserProfile,
  TenantMembership,
  Permission,
  resolvePermissions,
} from "./types";

interface AuthContextValue {
  /** True when a signed-in user profile was loaded */
  isAuthenticated: boolean;
  /** True while loading the backend profile */
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
  const [backendProfile, setBackendProfile] = useState<UserProfile | null>(null);
  const [tenants, setTenants] = useState<TenantMembership[]>([]);
  const [profileLoading, setProfileLoading] = useState(true);
  const [activeTenantId, setActiveTenantIdState] = useState<string | null>(null);

  // Fetch the backend profile; 401 means there is no session
  const fetchProfile = useCallback(async () => {
    setProfileLoading(true);
    try {
      const response = await fetch("/api/v1/me", {
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        setBackendProfile(null);
        setTenants([]);
        return;
      }

      const data: { user: UserProfile; tenants: TenantMembership[] } =
        await response.json();
      setBackendProfile(data.user);
      setTenants(data.tenants);

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
      setBackendProfile(null);
      setTenants([]);
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

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

  const isAuthenticated = backendProfile !== null;
  const isLoading = profileLoading;
  const hasNoAccess =
    isAuthenticated &&
    !isLoading &&
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
