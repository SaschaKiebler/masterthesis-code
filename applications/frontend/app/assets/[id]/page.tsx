/**
 * Asset Detail Page
 * Detailed view of a single asset with measurements and editable signal map
 */

"use client";

import { use, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/Header";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { Button } from "@/components/ui/Button";
import { MeasurementChart } from "@/components/charts/MeasurementChart";
import { AssetInfoCard } from "@/components/assets/AssetInfoCard";
import { SignalMapDisplay, resolveSignalLabel } from "@/components/assets/SignalMapDisplay";
import { ApplyTemplateModal } from "@/components/assets/ApplyTemplateModal";
import { RelocateAssetModal } from "@/components/assets/RelocateAssetModal";
import { useAsset, useLatestMeasurements, useMeasurements } from "@/lib/hooks/useAsset";
import { formatRelativeTime, formatMeasurement } from "@/lib/utils/format";
import { ArrowLeft, ArrowRightLeft, Activity, BarChart3, Clock, FileStack } from "lucide-react";

interface AssetDetailPageProps {
    params: Promise<{ id: string }>;
}

export default function AssetDetailPage({ params }: AssetDetailPageProps) {
    const { id } = use(params);
    const router = useRouter();
    const [timeRange, setTimeRange] = useState<"1h" | "3h" | "6h" | "24h" | "7d" | "30d" | "custom">("24h");
    const [customMode, setCustomMode] = useState<"relative" | "absolute">("relative");
    const [customAmount, setCustomAmount] = useState(2);
    const [customUnit, setCustomUnit] = useState<"hours" | "days">("hours");
    const [customFrom, setCustomFrom] = useState("");
    const [customTo, setCustomTo] = useState("");
    const [showTemplateModal, setShowTemplateModal] = useState(false);
    const [showRelocateModal, setShowRelocateModal] = useState(false);

    const { asset, isLoading: assetLoading, isError: assetError, mutate: mutateAsset } = useAsset(id);
    const { measurements: latestMeasurements, isLoading: latestLoading } = useLatestMeasurements(id);

    // Calculate time range — round to 5-minute boundaries for a stable SWR key
    const FIVE_MIN = 5 * 60;
    const nowRounded = Math.ceil(Date.now() / 1000 / FIVE_MIN) * FIVE_MIN;
    const presetSeconds: Record<string, number> = {
        "1h": 3600,
        "3h": 3 * 3600,
        "6h": 6 * 3600,
        "24h": 24 * 3600,
        "7d": 7 * 24 * 3600,
        "30d": 30 * 24 * 3600,
    };
    const presetBuckets: Record<string, number> = {
        "1h": 1,
        "3h": 1,
        "6h": 5,
        "24h": 60,
        "7d": 360,
        "30d": 1440,
    };

    const { from, to, bucketMinutes } = useMemo(() => {
        if (timeRange === "custom") {
            if (customMode === "relative" && customAmount > 0) {
                const spanSeconds = customUnit === "hours"
                    ? customAmount * 3600
                    : customAmount * 86400;
                const f = nowRounded - spanSeconds;
                const spanHours = spanSeconds / 3600;
                const bucket = spanHours <= 3 ? 1 : spanHours <= 6 ? 5 : spanHours <= 24 ? 15 : spanHours <= 72 ? 60 : 360;
                return { from: f, to: nowRounded, bucketMinutes: bucket };
            }
            if (customMode === "absolute" && customFrom && customTo) {
                const f = Math.floor(new Date(customFrom).getTime() / 1000);
                const t = Math.floor(new Date(customTo).getTime() / 1000);
                if (f > 0 && t > f) {
                    const spanHours = (t - f) / 3600;
                    const bucket = spanHours <= 6 ? 1 : spanHours <= 24 ? 5 : spanHours <= 72 ? 15 : 60;
                    return { from: f, to: t, bucketMinutes: bucket };
                }
            }
            const f = nowRounded - 86400;
            return { from: f, to: nowRounded, bucketMinutes: 60 };
        }
        const f = nowRounded - (presetSeconds[timeRange] ?? 86400);
        return { from: f, to: nowRounded, bucketMinutes: presetBuckets[timeRange] ?? 60 };
    }, [timeRange, customMode, customAmount, customUnit, customFrom, customTo, nowRounded]);

    const { measurements, isLoading: measurementsLoading } = useMeasurements(
        id,
        { from, to },
        bucketMinutes
    );

    if (assetLoading) {
        return (
            <div className="min-h-screen bg-background">
                <Header title="Asset Details" />
                <div className="p-4 md:p-8 flex items-center justify-center">
                    <LoadingSpinner size="lg" />
                </div>
            </div>
        );
    }

    if (assetError || !asset) {
        return (
            <div className="min-h-screen bg-background">
                <Header title="Asset Details" />
                <div className="p-4 md:p-8">
                    <ErrorMessage
                        title="Failed to load asset"
                        message="Unable to fetch asset details. The asset may not exist or the Core Platform may be unavailable."
                        onRetry={() => mutateAsset()}
                    />
                </div>
            </div>
        );
    }

    // Extract raw signal map JSON for display and label resolution
    const signalMapJson = typeof asset.signalMap === "string"
        ? asset.signalMap
        : asset.signalMap?.json || "{}";

    return (
        <div className="min-h-screen bg-background">
            <Header
                title={asset.name || "Unnamed Asset"}
                subtitle={asset.deviceId}
                breadcrumbs={[
                    { label: "Dashboard", href: "/" },
                    { label: asset.name || "Asset" },
                ]}
                actions={
                    <div className="flex items-center gap-1.5 sm:gap-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => router.push(`/sites/${asset.siteId}`)}
                            aria-label="Back to Site"
                        >
                            <ArrowLeft className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                            <span className="hidden sm:inline">Back to Site</span>
                        </Button>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setShowTemplateModal(true)}
                            aria-label="Apply Template"
                        >
                            <FileStack className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                            <span className="hidden sm:inline">Apply Template</span>
                        </Button>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setShowRelocateModal(true)}
                            aria-label="Move Asset"
                        >
                            <ArrowRightLeft className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                            <span className="hidden sm:inline">Move</span>
                        </Button>
                        {asset.siteId && (
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => router.push(`/sites/${asset.siteId}/analysis`)}
                                aria-label="Open in Analysis"
                            >
                                <BarChart3 className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                                <span className="hidden sm:inline">Analyze Site</span>
                            </Button>
                        )}
                    </div>
                }
            />

            <div className="p-4 md:p-8 space-y-4 md:space-y-6">
                {/* Asset Information (inline editable) + optional side readings */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
                    <AssetInfoCard asset={asset} onUpdate={() => mutateAsset()} />

                    {/* Side card: only shown when ≤ 3 readings on desktop */}
                    {!latestLoading && latestMeasurements.length > 0 && latestMeasurements.length <= 3 && (
                        <Card variant="elevated">
                            <CardHeader>
                                <CardTitle>Latest Readings</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-3">
                                    {latestMeasurements.map((measurement, index) => {
                                        const resolved = resolveSignalLabel(signalMapJson, measurement.metricId);
                                        const displayName = resolved.name !== `Metric ${measurement.metricId}`
                                            ? resolved.name
                                            : measurement.metricName || resolved.name;

                                        return (
                                            <div key={index} className="p-3 rounded-lg bg-muted/50">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <Activity className="h-4 w-4 text-primary" aria-hidden="true" />
                                                    <p className="text-sm font-medium text-foreground">
                                                        {displayName}
                                                    </p>
                                                </div>
                                                <p className="text-2xl font-bold text-foreground">
                                                    {formatMeasurement(measurement.value, resolved.unit)}
                                                </p>
                                                <p className="text-xs text-muted-foreground mt-1">
                                                    {formatRelativeTime(measurement.time)}
                                                </p>
                                            </div>
                                        );
                                    })}
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* Side card: loading or empty state */}
                    {(latestLoading || latestMeasurements.length === 0) && (
                        <Card variant="elevated">
                            <CardHeader>
                                <CardTitle>Latest Readings</CardTitle>
                            </CardHeader>
                            <CardContent>
                                {latestLoading ? (
                                    <LoadingSpinner size="sm" />
                                ) : (
                                    <p className="text-sm text-muted-foreground">No recent measurements</p>
                                )}
                            </CardContent>
                        </Card>
                    )}
                </div>

                {/* Compact readings card: shown below when > 3 readings */}
                {!latestLoading && latestMeasurements.length > 3 && (
                    <Card variant="elevated">
                        <CardHeader>
                            <CardTitle>Latest Readings</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                                {latestMeasurements.map((measurement, index) => {
                                    const resolved = resolveSignalLabel(signalMapJson, measurement.metricId);
                                    const displayName = resolved.name !== `Metric ${measurement.metricId}`
                                        ? resolved.name
                                        : measurement.metricName || resolved.name;

                                    return (
                                        <div key={index} className="p-3 rounded-lg bg-muted/50">
                                            <div className="flex items-center gap-1.5 mb-1 min-w-0">
                                                <Activity className="h-3.5 w-3.5 text-primary shrink-0" aria-hidden="true" />
                                                <p className="text-xs font-medium text-muted-foreground truncate">
                                                    {displayName}
                                                </p>
                                            </div>
                                            <p className="text-lg font-bold text-foreground">
                                                {formatMeasurement(measurement.value, resolved.unit)}
                                            </p>
                                            <p className="text-xs text-muted-foreground mt-0.5">
                                                {formatRelativeTime(measurement.time)}
                                            </p>
                                        </div>
                                    );
                                })}
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* Signal Map (view + inline edit) */}
                <SignalMapDisplay
                    assetId={id}
                    signalMapJson={signalMapJson}
                    onUpdate={() => mutateAsset()}
                />

                {/* Measurements Chart */}
                <Card variant="elevated">
                    <CardHeader>
                        <div className="flex flex-col gap-3">
                            <div className="flex items-center justify-between flex-wrap gap-2">
                                <CardTitle>Measurements History</CardTitle>
                                <div className="flex items-center gap-1.5">
                                    <div className="flex rounded-lg border border-border overflow-hidden">
                                        {(["1h", "3h", "6h", "24h", "7d", "30d"] as const).map((range) => (
                                            <button
                                                key={range}
                                                type="button"
                                                onClick={() => setTimeRange(range)}
                                                className={`px-2 py-1 sm:px-2.5 text-xs font-medium transition-colors border-r border-border last:border-r-0 ${
                                                    timeRange === range
                                                        ? "bg-primary text-primary-foreground"
                                                        : "bg-card text-muted-foreground hover:text-foreground hover:bg-muted"
                                                }`}
                                            >
                                                {range}
                                            </button>
                                        ))}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setTimeRange("custom")}
                                        className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border ${
                                            timeRange === "custom"
                                                ? "bg-primary text-primary-foreground border-primary"
                                                : "border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted"
                                        }`}
                                    >
                                        Custom
                                    </button>
                                </div>
                            </div>

                            {/* Custom range picker */}
                            {timeRange === "custom" && (
                                <div className="flex flex-col gap-3 p-3 rounded-lg bg-muted/30 border border-border/50">
                                    <div className="flex items-center justify-between flex-wrap gap-2">
                                        <div className="flex rounded-md border border-border overflow-hidden">
                                            <button
                                                type="button"
                                                onClick={() => setCustomMode("relative")}
                                                className={`px-3 py-1 text-xs font-medium transition-colors ${
                                                    customMode === "relative"
                                                        ? "bg-primary text-primary-foreground"
                                                        : "bg-card text-muted-foreground hover:text-foreground"
                                                }`}
                                            >
                                                Relative
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setCustomMode("absolute")}
                                                className={`px-3 py-1 text-xs font-medium transition-colors border-l border-border ${
                                                    customMode === "absolute"
                                                        ? "bg-primary text-primary-foreground"
                                                        : "bg-card text-muted-foreground hover:text-foreground"
                                                }`}
                                            >
                                                Absolute
                                            </button>
                                        </div>
                                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                            <Clock className="h-3 w-3" aria-hidden="true" />
                                            <span>
                                                {bucketMinutes <= 1 ? "1-min" : bucketMinutes < 60 ? `${bucketMinutes}-min` : bucketMinutes < 1440 ? `${Math.round(bucketMinutes / 60)}h` : `${Math.round(bucketMinutes / 1440)}d`} granularity
                                            </span>
                                        </div>
                                    </div>

                                    {customMode === "relative" && (
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm text-muted-foreground whitespace-nowrap">Last</span>
                                            <input
                                                type="number"
                                                value={customAmount}
                                                min={1}
                                                max={999}
                                                onChange={(e) => setCustomAmount(Math.max(1, parseInt(e.target.value) || 1))}
                                                className="w-16 px-2 py-1.5 rounded-md border border-border bg-card text-foreground text-sm text-center focus:outline-none focus:ring-2 focus:ring-primary/50"
                                            />
                                            <select
                                                value={customUnit}
                                                onChange={(e) => setCustomUnit(e.target.value as "hours" | "days")}
                                                className="px-2.5 py-1.5 rounded-md border border-border bg-card text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 cursor-pointer"
                                            >
                                                <option value="hours">hours</option>
                                                <option value="days">days</option>
                                            </select>
                                        </div>
                                    )}

                                    {customMode === "absolute" && (
                                        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
                                            <label className="text-sm text-muted-foreground">From</label>
                                            <input
                                                type="datetime-local"
                                                value={customFrom}
                                                onChange={(e) => setCustomFrom(e.target.value)}
                                                className="px-3 py-1.5 rounded-lg border border-border bg-card text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                                            />
                                            <label className="text-sm text-muted-foreground">To</label>
                                            <input
                                                type="datetime-local"
                                                value={customTo}
                                                onChange={(e) => setCustomTo(e.target.value)}
                                                className="px-3 py-1.5 rounded-lg border border-border bg-card text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                                            />
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </CardHeader>
                    <CardContent>
                        {measurementsLoading ? (
                            <div className="flex items-center justify-center h-64">
                                <LoadingSpinner size="md" />
                            </div>
                        ) : (
                            <MeasurementChart measurements={measurements} height={400} />
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Apply Template Modal */}
            <ApplyTemplateModal
                open={showTemplateModal}
                onClose={() => setShowTemplateModal(false)}
                assetId={id}
                assetName={asset.name || "Unnamed Asset"}
                onSuccess={() => mutateAsset()}
            />

            {/* Relocate Asset Modal */}
            <RelocateAssetModal
                open={showRelocateModal}
                onClose={() => setShowRelocateModal(false)}
                assetId={id}
                assetName={asset.name || "Unnamed Asset"}
                currentSiteId={asset.siteId}
                onSuccess={() => {
                    // Revalidate asset data — siteId may have changed
                    mutateAsset();
                }}
            />
        </div>
    );
}
