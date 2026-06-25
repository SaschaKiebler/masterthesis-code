/**
 * Stats Card Component
 * Display key metrics with trend indicators
 */

import { cn } from "@/lib/utils/cn";
import { LucideIcon } from "lucide-react";
import { Card } from "../ui/Card";

interface StatsCardProps {
    title: string;
    value: string | number;
    icon: LucideIcon;
    trend?: {
        value: number;
        isPositive: boolean;
    };
    className?: string;
}

export function StatsCard({ title, value, icon: Icon, trend, className }: StatsCardProps) {
    return (
        <Card variant="elevated" className={cn("relative overflow-hidden", className)}>
            <div className="flex items-start justify-between">
                <div>
                    <p className="text-sm text-muted-foreground mb-1">{title}</p>
                    <p className="text-3xl font-bold text-foreground">{value}</p>
                    {trend && (
                        <p className={cn(
                            "text-sm mt-2 flex items-center gap-1",
                            trend.isPositive ? "text-success" : "text-danger"
                        )}>
                            <span>{trend.isPositive ? "↑" : "↓"}</span>
                            <span>{Math.abs(trend.value)}%</span>
                            <span className="text-muted-foreground">vs last month</span>
                        </p>
                    )}
                </div>
                <div className="p-3 rounded-lg bg-primary/10">
                    <Icon className="h-6 w-6 text-primary" />
                </div>
            </div>
        </Card>
    );
}
