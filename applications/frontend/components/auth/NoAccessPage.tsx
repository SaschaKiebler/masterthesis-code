/**
 * NoAccessPage Component
 * Shown when a user is authenticated but has no tenant memberships
 * and no elevated global role. They need to be invited first.
 */

"use client";

import { ShieldX, LogOut, Mail } from "lucide-react";

export function NoAccessPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="mx-auto w-16 h-16 rounded-full bg-warning/10 flex items-center justify-center">
          <ShieldX className="h-8 w-8 text-warning" aria-hidden="true" />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-foreground">No Access Yet</h1>
          <p className="text-muted-foreground">
            Your account has been created, but you don&apos;t have access to any tenants yet.
          </p>
        </div>

        <div className="bg-card border border-border rounded-lg p-4 text-left space-y-3">
          <div className="flex items-start gap-3">
            <Mail className="h-5 w-5 text-primary mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-foreground">Check your email</p>
              <p className="text-sm text-muted-foreground">
                If you&apos;ve been invited, look for an invitation email with a magic link.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <ShieldX className="h-5 w-5 text-primary mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-foreground">Contact your administrator</p>
              <p className="text-sm text-muted-foreground">
                Ask your energy consultant or building manager to send you an invitation.
              </p>
            </div>
          </div>
        </div>

        <a
          href="/auth/logout"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Sign Out
        </a>
      </div>
    </div>
  );
}
