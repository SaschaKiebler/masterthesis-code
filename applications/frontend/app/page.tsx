/**
 * Dashboard Homepage
 * Routes to role-specific dashboard based on the user's global_role (ADR-009).
 * Falls back to a generic view for unauthenticated or viewer users.
 */

"use client";

import { useAuth } from "@/lib/auth/AuthContext";
import { NoAccessPage } from "@/components/auth/NoAccessPage";
import { ConsultantDashboard } from "@/components/dashboard/ConsultantDashboard";
import { LandlordDashboard } from "@/components/dashboard/LandlordDashboard";
import { TechnicianDashboard } from "@/components/dashboard/TechnicianDashboard";
import { Header } from "@/components/layout/Header";
import { StatsCardSkeleton } from "@/components/ui/Skeleton";

export default function DashboardPage() {
  const { globalRole, isLoading, isAuthenticated, hasNoAccess } = useAuth();

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Header title="Dashboard" subtitle="Loading..." />
        <div className="p-4 md:p-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
            <StatsCardSkeleton />
            <StatsCardSkeleton />
            <StatsCardSkeleton />
            <StatsCardSkeleton />
          </div>
        </div>
      </div>
    );
  }

  // User authenticated but no tenant access
  if (hasNoAccess) {
    return <NoAccessPage />;
  }

  // Role-specific dashboards
  switch (globalRole) {
    case "system_admin":
    case "consultant":
      return <ConsultantDashboard />;

    case "landlord":
      return <LandlordDashboard />;

    case "technician":
      return <TechnicianDashboard />;

    default:
      // Viewer or unauthenticated — show landlord dashboard as generic fallback
      return <LandlordDashboard />;
  }
}
