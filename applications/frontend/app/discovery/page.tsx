/**
 * Discovery Page
 * MQTT device discovery for sniffing live messages and creating templates.
 * Permission-gated: template:create (consultants, system admins)
 */

"use client";

import { Suspense } from "react";
import { Header } from "@/components/layout/Header";
import { SiteCardSkeleton } from "@/components/ui/Skeleton";
import { DiscoveryPageContent } from "@/components/discovery/DiscoveryPageContent";

export default function DiscoveryPage() {
    return (
        <Suspense fallback={<DiscoveryLoadingSkeleton />}>
            <DiscoveryPageContent />
        </Suspense>
    );
}

function DiscoveryLoadingSkeleton() {
    return (
        <div className="min-h-screen bg-background">
            <Header
                title="Device Scanner"
                subtitle="Scan and receive MQTT messages from devices"
                breadcrumbs={[
                    { label: "Dashboard", href: "/" },
                    { label: "Device Scanner" },
                ]}
            />
            <div className="p-4 md:p-8">
                <div className="space-y-4">
                    <SiteCardSkeleton />
                    <SiteCardSkeleton />
                </div>
            </div>
        </div>
    );
}
