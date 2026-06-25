/**
 * Asset Card Component
 * Display asset information in a card format
 */

import { Card, CardContent } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { Activity, Thermometer, Zap, Gauge } from "lucide-react";
import type { AssetSummary } from "@/lib/api/types";
import { cn } from "@/lib/utils/cn";

interface AssetCardProps {
    asset: AssetSummary;
    onClick?: () => void;
}

// Map asset types to icons
const assetTypeIcons: Record<string, typeof Activity> = {
    SENSOR: Thermometer,
    ACTUATOR: Zap,
    HEATER: Activity,
    METER: Gauge,
    GATEWAY: Activity,
};

// Map asset types to badge variants
const assetTypeBadgeVariants: Record<string, "primary" | "success" | "warning" | "secondary"> = {
    SENSOR: "primary",
    ACTUATOR: "warning",
    HEATER: "warning",
    METER: "success",
    GATEWAY: "secondary",
};

export function AssetCard({ asset, onClick }: AssetCardProps) {
    const Icon = assetTypeIcons[asset.type] || Activity;
    const badgeVariant = assetTypeBadgeVariants[asset.type] || "default";

    return (
        <Card
            variant="bordered"
            hover={!!onClick}
            onClick={onClick}
            className={cn(onClick && "cursor-pointer")}
        >
            <CardContent>
                <div className="flex items-start justify-between mb-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                        <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <Badge variant={badgeVariant} size="sm">
                        {asset.type}
                    </Badge>
                </div>

                <h4 className="font-semibold text-foreground mb-1">
                    {asset.name || "Unnamed Asset"}
                </h4>

                <p className="text-sm text-muted-foreground mb-2">
                    {asset.deviceId}
                </p>

                {asset.modelHuman && (
                    <p className="text-xs text-muted-foreground">
                        Model: {asset.modelHuman}
                    </p>
                )}
            </CardContent>
        </Card>
    );
}
