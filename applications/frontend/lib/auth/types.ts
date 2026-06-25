/**
 * Auth types for the RBAC multi-tenancy model (ADR-009).
 */

export type GlobalRole = 'system_admin' | 'consultant' | 'landlord' | 'technician' | 'resident' | 'viewer';
export type TenantRole = 'owner' | 'manager' | 'member' | 'viewer';

export interface UserProfile {
  id: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  globalRole: GlobalRole;
}

export interface TenantMembership {
  id: string;
  name: string;
  tenantRole: TenantRole;
}

export type Permission =
  | 'tenant:create'
  | 'tenant:manage'
  | 'tenant:view'
  | 'site:view'
  | 'site:create'
  | 'site:configure'
  | 'asset:view'
  | 'asset:configure'
  | 'asset:secrets'
  | 'measurement:view'
  | 'physics:view'
  | 'report:generate'
  | 'report:view'
  | 'contact:manage'
  | 'template:create'
  | 'template:manage'
  | 'template:view'
  | 'team:manage'
  | 'user:manage'
  | 'invitation:manage'
  | 'fleet:view';

/**
 * Resolve permissions from global role + tenant role.
 */
export function resolvePermissions(globalRole: GlobalRole, tenantRole?: TenantRole): Set<Permission> {
  const perms = new Set<Permission>();

  // Everyone can view sites and measurements they have access to
  perms.add('site:view');
  perms.add('asset:view');
  perms.add('measurement:view');
  perms.add('template:view');

  // Tenant role-based
  if (tenantRole === 'owner' || tenantRole === 'manager') {
    perms.add('contact:manage');
    perms.add('report:view');
  }

  if (tenantRole === 'manager') {
    perms.add('site:create');
    perms.add('site:configure');
    perms.add('asset:configure');
    perms.add('asset:secrets');
    perms.add('report:generate');
    perms.add('template:create');
    perms.add('team:manage');
  }

  if (tenantRole === 'member') {
    perms.add('physics:view');
  }

  // Global role overrides
  if (globalRole === 'consultant' || globalRole === 'system_admin') {
    perms.add('tenant:create');
    perms.add('tenant:manage');
    perms.add('tenant:view');
    perms.add('fleet:view');
    perms.add('site:create');
    perms.add('site:configure');
    perms.add('asset:configure');
    perms.add('asset:secrets');
    perms.add('report:generate');
    perms.add('report:view');
    perms.add('contact:manage');
    perms.add('template:create');
    perms.add('invitation:manage');
    perms.add('team:manage');
    perms.add('physics:view');
  }

  // System admin exclusive
  if (globalRole === 'system_admin') {
    perms.add('user:manage');
    perms.add('template:manage');
  }

  if (globalRole === 'technician') {
    perms.add('physics:view');
  }

  if (globalRole === 'landlord') {
    perms.add('report:view');
    perms.add('contact:manage');
  }

  return perms;
}

/**
 * Navigation items filtered by role.
 */
export interface NavItem {
  name: string;
  href: string;
  icon: string;
  requiredPermission?: Permission;
  requiredRoles?: GlobalRole[];
}
