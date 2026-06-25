"use client";

import { Button } from "@/components/ui/Button";
import { Plus, LayoutTemplate, Rocket } from "lucide-react";

export function EmptyState({
    greeting,
    displayName,
    subtitle,
    onCreateProject,
    onBrowseTemplates,
}: {
    greeting: string;
    displayName: string;
    subtitle: string;
    onCreateProject: () => void;
    onBrowseTemplates: () => void;
}) {
    return (
        <>
            <div className="p-4 md:p-8">
                <div className="flex flex-col items-center justify-center py-16 md:py-24 text-center max-w-lg mx-auto">
                    <div className="p-5 rounded-full bg-primary/10 mb-6">
                        <Rocket className="h-12 w-12 text-primary" />
                    </div>
                    <h2 className="text-xl font-semibold text-foreground mb-3">
                        Welcome to the platform
                    </h2>
                    <p className="text-sm text-muted-foreground mb-8 leading-relaxed">
                        Create your first project to start adding buildings,
                        connecting sensors, and setting up monitoring dashboards for your clients.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-3">
                        <Button variant="primary" onClick={onCreateProject}>
                            <Plus className="h-4 w-4 mr-1.5" />
                            Create First Project
                        </Button>
                        <Button variant="ghost" onClick={onBrowseTemplates}>
                            <LayoutTemplate className="h-4 w-4 mr-1.5" />
                            Browse Device Catalog
                        </Button>
                    </div>
                </div>
            </div>
        </>
    );
}
