"use client";

import { Suspense } from "react";
import { Header } from "@/components/layout/Header";
import { SiteCardSkeleton } from "@/components/ui/Skeleton";
import TenantsPageContent from "./TenantsPageContent";

export default function TenantsPage() {
    return (
        <Suspense
            fallback={
                <div className="min-h-screen bg-background">
                    <Header
                        title="Tenants"
                        subtitle="Manage tenants and onboarding"
                        breadcrumbs={[
                            { label: "Dashboard", href: "/" },
                            { label: "Tenants" },
                        ]}
                    />
                    <div className="p-4 md:p-8">
                        <div className="space-y-3">
                            <SiteCardSkeleton />
                            <SiteCardSkeleton />
                            <SiteCardSkeleton />
                        </div>
                    </div>
                </div>
            }
        >
            <TenantsPageContent />
        </Suspense>
    );
}
