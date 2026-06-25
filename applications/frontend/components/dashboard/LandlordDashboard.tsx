/**
 * Landlord Dashboard
 * Building health overview, compliance status, cost savings, recent activity.
 * Shown when global_role === 'landlord'.
 */

"use client";

import { Header } from "@/components/layout/Header";
import { StatsCard } from "@/components/charts/StatsCard";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { StatsCardSkeleton, ListItemSkeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";
import { useAuth } from "@/lib/auth/AuthContext";
import { useSites } from "@/lib/hooks/useSites";
import { useDashboardHealth } from "@/lib/hooks/useDashboardHealth";
import { Building2, Thermometer, Heart, AlertTriangle } from "lucide-react";

export function LandlordDashboard() {
  const { activeTenant } = useAuth();
  const { sites, pageInfo, isLoading } = useSites();
  const { health, isLoading: healthLoading } = useDashboardHealth(sites);

  const totalSites = pageInfo?.totalItems || 0;
  const totalAssets = sites.reduce((sum, site) => sum + site.assetCount, 0);
  const issueCount = health ? health.warningCount + health.criticalCount : 0;
  const allHealthy = health ? issueCount === 0 && health.noDataCount === 0 && totalSites > 0 : null;

  const subtitle = activeTenant
    ? activeTenant.name
    : "Your Building Overview";

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Header title="Dashboard" subtitle={subtitle} />
        <div className="p-4 md:p-8 space-y-6 md:space-y-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
            <StatsCardSkeleton />
            <StatsCardSkeleton />
            <StatsCardSkeleton />
            <StatsCardSkeleton />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
            <Card variant="elevated"><CardContent><ListItemSkeleton /><ListItemSkeleton /><ListItemSkeleton /></CardContent></Card>
            <Card variant="elevated"><CardContent><ListItemSkeleton /><ListItemSkeleton /></CardContent></Card>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header title="Dashboard" subtitle={subtitle} />

      <div className="p-4 md:p-8 space-y-6 md:space-y-8">
        {/* Stats — simple, glanceable (per UX guidelines for landlords) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
          <StatsCard title="Buildings" value={totalSites} icon={Building2} />
          <StatsCard
            title="Health"
            value={allHealthy === null ? (healthLoading ? "…" : "—") : allHealthy ? "OK" : `${issueCount} issue${issueCount !== 1 ? "s" : ""}`}
            icon={allHealthy === false ? AlertTriangle : Heart}
            className={allHealthy === false ? "ring-1 ring-warning/50" : undefined}
          />
          <StatsCard title="Sensors" value={totalAssets} icon={Thermometer} />
          <StatsCard
            title="Warnings"
            value={health?.warningCount ?? (healthLoading ? "…" : 0)}
            icon={AlertTriangle}
            className={health && health.warningCount > 0 ? "ring-1 ring-warning/50" : undefined}
          />
        </div>

        {/* Buildings */}
        <Card variant="elevated">
          <CardHeader>
            <CardTitle>Your Buildings</CardTitle>
          </CardHeader>
          <CardContent>
            {sites.length === 0 ? (
              <p className="text-muted-foreground text-sm">No buildings configured yet. Your consultant will set these up for you.</p>
            ) : (
              <div className="space-y-2 md:space-y-3">
                {sites.slice(0, 5).map((site) => (
                  <div
                    key={site.id}
                    className="block p-3 rounded-lg"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground truncate">{site.name}</p>
                        <p className="text-sm text-muted-foreground mt-0.5">
                          {site.assetCount} sensors
                        </p>
                      </div>
                      {(() => {
                        const sh = health?.siteHealth[site.id];
                        if (!sh || sh.status === "no_data") return <Badge variant="secondary" size="sm">No data</Badge>;
                        if (sh.status === "critical") return <Badge variant="danger" size="sm">Critical</Badge>;
                        if (sh.status === "warning") return <Badge variant="warning" size="sm">Stale data</Badge>;
                        return <Badge variant="success" size="sm">All OK</Badge>;
                      })()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Status Banner */}
        {health && (
          <Card
            variant="bordered"
            className={allHealthy
              ? "border-success/50 bg-success/5"
              : health.criticalCount > 0
                ? "border-danger/50 bg-danger/5"
                : issueCount > 0
                  ? "border-warning/50 bg-warning/5"
                  : "border-muted bg-muted/5"
            }
          >
            <CardContent>
              <div className="flex items-center gap-3">
                <div
                  className={`h-3 w-3 rounded-full shrink-0 ${
                    allHealthy
                      ? "bg-success animate-pulse"
                      : health.criticalCount > 0
                        ? "bg-danger animate-pulse"
                        : issueCount > 0
                          ? "bg-warning animate-pulse"
                          : "bg-muted-foreground"
                  }`}
                  aria-hidden="true"
                />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground">
                    {allHealthy
                      ? "Everything looks good"
                      : health.criticalCount > 0
                        ? `${health.criticalCount} building${health.criticalCount !== 1 ? "s" : ""} need${health.criticalCount === 1 ? "s" : ""} attention`
                        : health.warningCount > 0
                          ? `${health.warningCount} building${health.warningCount !== 1 ? "s" : ""} with stale data`
                          : health.noDataCount > 0
                            ? "Waiting for sensor data"
                            : "No buildings configured"
                    }
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {allHealthy
                      ? "All heating systems are running normally"
                      : health.healthyCount > 0
                        ? `${health.healthyCount} of ${totalSites} building${totalSites !== 1 ? "s" : ""} reporting normally`
                        : totalSites > 0
                          ? "Check building details for more information"
                          : "Your consultant will set up buildings for you"
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
