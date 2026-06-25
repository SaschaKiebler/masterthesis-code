/**
 * UserProfile Component
 * Displays user avatar, name, role badge, and logout button in the sidebar
 * Uses AuthContext for role information (ADR-009)
 */

"use client";

import { useUser } from "@auth0/nextjs-auth0/client";
import { LogOut, LogIn, User } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";
import type { GlobalRole } from "@/lib/auth/types";

const ROLE_LABELS: Record<GlobalRole, string> = {
  system_admin: "Admin",
  consultant: "Consultant",
  landlord: "Landlord",
  technician: "Technician",
  resident: "Resident",
  viewer: "Viewer",
};

const ROLE_COLORS: Record<GlobalRole, string> = {
  system_admin: "bg-danger/10 text-danger",
  consultant: "bg-primary/10 text-primary",
  landlord: "bg-success/10 text-success",
  technician: "bg-warning/10 text-warning",
  resident: "bg-muted text-muted-foreground",
  viewer: "bg-muted text-muted-foreground",
};

export function UserProfile({ collapsed = false }: { collapsed?: boolean }) {
  const { user: auth0User, isLoading: auth0Loading } = useUser();
  const { globalRole, isLoading: authLoading } = useAuth();

  if (auth0Loading || authLoading) {
    return (
      <div className={collapsed ? "flex justify-center p-2" : "flex items-center gap-3 p-2"}>
        <div className="h-8 w-8 rounded-full bg-muted animate-pulse shrink-0" />
        {!collapsed && (
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="h-3 w-20 bg-muted rounded animate-pulse" />
            <div className="h-2.5 w-28 bg-muted rounded animate-pulse" />
          </div>
        )}
      </div>
    );
  }

  if (!auth0User) {
    return (
      <a
        href="/auth/login"
        className={
          collapsed
            ? "flex justify-center px-2 py-2 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-all duration-200"
            : "flex items-center gap-3 px-3 py-2 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-all duration-200"
        }
        title={collapsed ? "Sign In" : undefined}
      >
        <LogIn className="h-5 w-5" aria-hidden="true" />
        {!collapsed && <span className="font-medium text-sm">Sign In</span>}
      </a>
    );
  }

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-2">
        {auth0User.picture ? (
          <img
            src={auth0User.picture}
            alt={auth0User.name || "User avatar"}
            className="h-8 w-8 rounded-full ring-2 ring-border"
            title={auth0User.name || undefined}
          />
        ) : (
          <div
            className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center"
            title={auth0User.name || undefined}
          >
            <User className="h-4 w-4 text-primary" aria-hidden="true" />
          </div>
        )}
        <a
          href="/auth/logout"
          className="flex justify-center px-2 py-2 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-all duration-200"
          title="Sign Out"
          aria-label="Sign Out"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 p-2">
        {auth0User.picture ? (
          <img
            src={auth0User.picture}
            alt={auth0User.name || "User avatar"}
            className="h-8 w-8 rounded-full shrink-0 ring-2 ring-border"
          />
        ) : (
          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <User className="h-4 w-4 text-primary" aria-hidden="true" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-foreground truncate">
              {auth0User.name}
            </p>
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${ROLE_COLORS[globalRole]}`}>
              {ROLE_LABELS[globalRole]}
            </span>
          </div>
          <p className="text-xs text-muted-foreground truncate">
            {auth0User.email}
          </p>
        </div>
      </div>
      <a
        href="/auth/logout"
        className="flex items-center gap-3 px-3 py-2 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-all duration-200"
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
        <span className="text-sm">Sign Out</span>
      </a>
    </div>
  );
}

/**
 * Compact user button for mobile bottom nav
 */
export function UserButton() {
  const { user, isLoading } = useUser();

  if (isLoading) {
    return (
      <div className="h-8 w-8 rounded-full bg-muted animate-pulse" />
    );
  }

  if (!user) {
    return (
      <a
        href="/auth/login"
        className="flex flex-col items-center justify-center gap-1 px-3 py-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-200 min-w-[64px] min-h-[48px]"
        aria-label="Sign In"
      >
        <LogIn className="h-6 w-6" aria-hidden="true" />
        <span className="text-xs font-medium">Sign In</span>
      </a>
    );
  }

  return (
    <a
      href="/settings"
      className="flex flex-col items-center justify-center gap-1 px-3 py-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-200 min-w-[64px] min-h-[48px]"
      aria-label="Account settings"
    >
      {user.picture ? (
        <img
          src={user.picture}
          alt={user.name || "User"}
          className="h-6 w-6 rounded-full ring-1 ring-border"
        />
      ) : (
        <User className="h-6 w-6" aria-hidden="true" />
      )}
      <span className="text-xs font-medium">Account</span>
    </a>
  );
}
