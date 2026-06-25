/**
 * Technician Dashboard
 * Assigned sites overview, active anomalies, quick access to physics views.
 * Shown when global_role === 'technician'.
 */

"use client";

import { Header } from "@/components/layout/Header";
import { StatsCard } from "@/components/charts/StatsCard";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { StatsCardSkeleton, ListItemSkeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";
import { useSites } from "@/lib/hooks/useSites";
import { useDashboardHealth } from "@/lib/hooks/useDashboardHealth";
import { Building2, Activity, AlertTriangle, AlertCircle } from "lucide-react";

export function TechnicianDashboard() {
  const { sites, pageInfo, isLoading } = useSites();
  const { health, isLoading: healthLoading } = useDashboardHealth(sites);

  const totalSites = pageInfo?.totalItems || 0;
  const totalAssets = sites.reduce((sum, site) => sum + site.assetCount, 0);
  const warningCount = health?.warningCount ?? 0;
  const criticalCount = health?.criticalCount ?? 0;
  const issueCount = warningCount + criticalCount;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Header title="Dashboard" subtitle="Your Assigned Sites" />
        <div className="p-4 md:p-8 space-y-6 md:space-y-8">
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

  return (
    <div className="min-h-screen bg-background">
      <Header title="Dashboard" subtitle="Your Assigned Sites" />

      <div className="p-4 md:p-8 space-y-6 md:space-y-8">
        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
          <StatsCard title="Assigned Sites" value={totalSites} icon={Building2} />
          <StatsCard title="Total Devices" value={totalAssets} icon={Activity} />
          <StatsCard
            title="Warnings"
            value={health ? warningCount : (healthLoading ? "…" : 0)}
            icon={AlertTriangle}
            className={warningCount > 0 ? "ring-1 ring-warning/50" : undefined}
          />
          <StatsCard
            title="Critical"
            value={health ? criticalCount : (healthLoading ? "…" : 0)}
            icon={AlertCircle}
            className={criticalCount > 0 ? "ring-1 ring-danger/50" : undefined}
          />
        </div>

        {/* Assigned Sites */}
        <Card variant="elevated">
          <CardHeader>
            <CardTitle>Assigned Sites</CardTitle>
          </CardHeader>
          <CardContent>
            {sites.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No sites assigned yet. Your consultant will assign buildings to you.
              </p>
            ) : (
              <div className="space-y-2 md:space-y-3">
                {sites.map((site) => (
                  <div
                    key={site.id}
                    className="block p-3 rounded-lg"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground truncate">{site.name}</p>
                        <p className="text-sm text-muted-foreground mt-0.5">
                          {site.assetCount} devices
                        </p>
                      </div>
                      {(() => {
                        const sh = health?.siteHealth[site.id];
                        if (!sh || sh.status === "no_data") return <Badge variant="secondary" size="sm">No data</Badge>;
                        if (sh.status === "critical") return <Badge variant="danger" size="sm">Offline</Badge>;
                        if (sh.status === "warning") return <Badge variant="warning" size="sm">Stale</Badge>;
                        return <Badge variant="success" size="sm">Online</Badge>;
                      })()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Status */}
        {health && (
          <Card
            variant="bordered"
            className={issueCount === 0 && health.noDataCount === 0 && totalSites > 0
              ? "border-success/50 bg-success/5"
              : criticalCount > 0
                ? "border-danger/50 bg-danger/5"
                : warningCount > 0
                  ? "border-warning/50 bg-warning/5"
                  : "border-muted bg-muted/5"
            }
          >
            <CardContent>
              <div className="flex items-center gap-3">
                <div
                  className={`h-3 w-3 rounded-full shrink-0 ${
                    issueCount === 0 && health.noDataCount === 0 && totalSites > 0
                      ? "bg-success animate-pulse"
                      : criticalCount > 0
                        ? "bg-danger animate-pulse"
                        : warningCount > 0
                          ? "bg-warning animate-pulse"
                          : "bg-muted-foreground"
                  }`}
                  aria-hidden="true"
                />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground">
                    {issueCount === 0 && health.noDataCount === 0 && totalSites > 0
                      ? "All devices online"
                      : criticalCount > 0
                        ? `${criticalCount} site${criticalCount !== 1 ? "s" : ""} offline`
                        : warningCount > 0
                          ? `${warningCount} site${warningCount !== 1 ? "s" : ""} with stale data`
                          : totalSites > 0
                            ? "Waiting for sensor data"
                            : "No sites assigned yet"
                    }
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {issueCount === 0 && health.noDataCount === 0 && totalSites > 0
                      ? "No anomalies detected"
                      : health.healthyCount > 0
                        ? `${health.healthyCount} of ${totalSites} site${totalSites !== 1 ? "s" : ""} reporting normally`
                        : totalSites > 0
                          ? "Check site details for diagnostics"
                          : "Your consultant will assign buildings to you"
                    }
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
