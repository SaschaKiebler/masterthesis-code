/**
 * Templates Page
 * Ontology Registry management for device templates and object types (ADR-007 Phase 4)
 * Permission-gated: template:create (consultants, system admins, tenant managers)
 */

"use client";

import { Suspense } from "react";
import { Header } from "@/components/layout/Header";
import { SiteCardSkeleton } from "@/components/ui/Skeleton";
import { TemplatesPageContent } from "@/components/templates/TemplatesPageContent";

export default function TemplatesPage() {
    return (
        <Suspense fallback={<TemplatesLoadingSkeleton />}>
            <TemplatesPageContent />
        </Suspense>
    );
}

function TemplatesLoadingSkeleton() {
    return (
        <div className="min-h-screen bg-background">
            <Header
                title="Device Catalog"
                subtitle="Device templates and asset types"
                breadcrumbs={[
                    { label: "Dashboard", href: "/" },
                    { label: "Device Catalog" },
                ]}
            />
            <div className="p-4 md:p-8">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                    <SiteCardSkeleton />
                    <SiteCardSkeleton />
                    <SiteCardSkeleton />
                    <SiteCardSkeleton />
                    <SiteCardSkeleton />
                    <SiteCardSkeleton />
                </div>
            </div>
        </div>
    );
}
