/**
 * TenantSwitcher Component
 * Dropdown for consultants to switch between tenants or enter fleet mode.
 * Only rendered for consultant and system_admin roles.
 */

"use client";

import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/lib/auth/AuthContext";
import { ChevronDown, Building2, Globe } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export function TenantSwitcher() {
  const { tenants, activeTenant, setActiveTenantId, globalRole } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Only show for multi-tenant users (must be after all hooks)
  if (globalRole !== "consultant" && globalRole !== "system_admin") return null;
  if (tenants.length <= 1) return null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-foreground bg-muted/50 hover:bg-muted transition-colors"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        {activeTenant ? (
          <>
            <Building2 className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
            <span className="truncate flex-1 text-left">{activeTenant.name}</span>
          </>
        ) : (
          <>
            <Globe className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
            <span className="truncate flex-1 text-left">All Tenants</span>
          </>
        )}
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground shrink-0 transition-transform", isOpen && "rotate-180")} aria-hidden="true" />
      </button>

      {isOpen && (
        <div
          className="absolute left-0 right-0 top-full mt-1 z-50 bg-card border border-border rounded-lg shadow-lg overflow-hidden"
          role="listbox"
          aria-label="Select tenant"
        >
          {/* Fleet mode option */}
          <button
            onClick={() => { setActiveTenantId(null); setIsOpen(false); }}
            className={cn(
              "w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-muted transition-colors text-left",
              !activeTenant && "bg-primary/5 text-primary font-medium"
            )}
            role="option"
            aria-selected={!activeTenant}
          >
            <Globe className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>All Tenants (Fleet View)</span>
          </button>

          <div className="border-t border-border" />

          {/* Tenant list */}
          {tenants.map((tenant) => (
            <button
              key={tenant.id}
              onClick={() => { setActiveTenantId(tenant.id); setIsOpen(false); }}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-muted transition-colors text-left",
                activeTenant?.id === tenant.id && "bg-primary/5 text-primary font-medium"
              )}
              role="option"
              aria-selected={activeTenant?.id === tenant.id}
            >
              <Building2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate flex-1">{tenant.name}</span>
              <span className="text-xs text-muted-foreground capitalize">{tenant.tenantRole}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
