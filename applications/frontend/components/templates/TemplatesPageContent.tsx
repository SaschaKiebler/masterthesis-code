/**
 * Templates Page Content
 * Tab orchestrator for Device Templates, Object Types, and Link Types
 * Client component — manages tab state, delegates to sub-components
 */

"use client";

import { useState } from "react";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/lib/auth/AuthContext";
import { DeviceTemplateList } from "@/components/templates/DeviceTemplateList";
import { ObjectTypeList } from "@/components/templates/ObjectTypeList";
import { LinkTypeList } from "@/components/templates/LinkTypeList";
import { EventTemplateList } from "@/components/templates/EventTemplateList";
import { LayoutTemplate, Boxes, Link2, ClipboardList, Plus } from "lucide-react";

type Tab = "templates" | "types" | "linkTypes" | "eventTemplates";

export function TemplatesPageContent() {
    const [activeTab, setActiveTab] = useState<Tab>("templates");
    const [showCreateTemplate, setShowCreateTemplate] = useState(false);
    const [showCreateType, setShowCreateType] = useState(false);
    const [showCreateLinkType, setShowCreateLinkType] = useState(false);
    const [showCreateEventTemplate, setShowCreateEventTemplate] = useState(false);
    const { can } = useAuth();

    const canCreateTemplates = can("template:create");
    const canManageTypes = can("template:manage");

    const actionButton =
        activeTab === "templates" && canCreateTemplates ? (
            <Button
                variant="primary"
                size="sm"
                onClick={() => setShowCreateTemplate(true)}
                aria-label="New Template"
            >
                <Plus className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                <span className="hidden sm:inline">New Template</span>
            </Button>
        ) : activeTab === "types" && canManageTypes ? (
            <Button
                variant="primary"
                size="sm"
                onClick={() => setShowCreateType(true)}
                aria-label="New Object Type"
            >
                <Plus className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                <span className="hidden sm:inline">New Type</span>
            </Button>
        ) : activeTab === "linkTypes" && canManageTypes ? (
            <Button
                variant="primary"
                size="sm"
                onClick={() => setShowCreateLinkType(true)}
                aria-label="New Link Type"
            >
                <Plus className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                <span className="hidden sm:inline">New Link Type</span>
            </Button>
        ) : activeTab === "eventTemplates" && canCreateTemplates ? (
            <Button
                variant="primary"
                size="sm"
                onClick={() => setShowCreateEventTemplate(true)}
                aria-label="New Event Template"
            >
                <Plus className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                <span className="hidden sm:inline">New Event Template</span>
            </Button>
        ) : null;

    return (
        <div className="min-h-screen bg-background">
            <Header
                title="Device Catalog"
                subtitle="Device templates, asset types, and relationship types"
                breadcrumbs={[
                    { label: "Dashboard", href: "/" },
                    { label: "Device Catalog" },
                ]}
                actions={actionButton}
            />

            <div className="p-4 md:p-8">
                {/* Tab Bar */}
                <div className="flex border-b border-border mb-6" role="tablist" aria-label="Templates sections">
                    <button
                        role="tab"
                        aria-selected={activeTab === "templates"}
                        aria-controls="panel-templates"
                        id="tab-templates"
                        className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                            activeTab === "templates"
                                ? "border-primary text-primary"
                                : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                        onClick={() => setActiveTab("templates")}
                    >
                        <LayoutTemplate className="h-4 w-4 inline mr-1.5" aria-hidden="true" />
                        Device Templates
                    </button>
                    <button
                        role="tab"
                        aria-selected={activeTab === "types"}
                        aria-controls="panel-types"
                        id="tab-types"
                        className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                            activeTab === "types"
                                ? "border-primary text-primary"
                                : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                        onClick={() => setActiveTab("types")}
                    >
                        <Boxes className="h-4 w-4 inline mr-1.5" aria-hidden="true" />
                        Object Types
                    </button>
                    <button
                        role="tab"
                        aria-selected={activeTab === "linkTypes"}
                        aria-controls="panel-linkTypes"
                        id="tab-linkTypes"
                        className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                            activeTab === "linkTypes"
                                ? "border-primary text-primary"
                                : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                        onClick={() => setActiveTab("linkTypes")}
                    >
                        <Link2 className="h-4 w-4 inline mr-1.5" aria-hidden="true" />
                        Link Types
                    </button>
                    <button
                        role="tab"
                        aria-selected={activeTab === "eventTemplates"}
                        aria-controls="panel-eventTemplates"
                        id="tab-eventTemplates"
                        className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                            activeTab === "eventTemplates"
                                ? "border-primary text-primary"
                                : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                        onClick={() => setActiveTab("eventTemplates")}
                    >
                        <ClipboardList className="h-4 w-4 inline mr-1.5" aria-hidden="true" />
                        Event Templates
                    </button>
                </div>

                {/* Tab Panels */}
                <div
                    role="tabpanel"
                    id="panel-templates"
                    aria-labelledby="tab-templates"
                    hidden={activeTab !== "templates"}
                >
                    {activeTab === "templates" && (
                        <DeviceTemplateList
                            showCreate={showCreateTemplate}
                            onShowCreateChange={setShowCreateTemplate}
                            canCreate={canCreateTemplates}
                        />
                    )}
                </div>

                <div
                    role="tabpanel"
                    id="panel-types"
                    aria-labelledby="tab-types"
                    hidden={activeTab !== "types"}
                >
                    {activeTab === "types" && (
                        <ObjectTypeList
                            showCreate={showCreateType}
                            onShowCreateChange={setShowCreateType}
                            canManage={canManageTypes}
                        />
                    )}
                </div>

                <div
                    role="tabpanel"
                    id="panel-linkTypes"
                    aria-labelledby="tab-linkTypes"
                    hidden={activeTab !== "linkTypes"}
                >
                    {activeTab === "linkTypes" && (
                        <LinkTypeList
                            showCreate={showCreateLinkType}
                            onShowCreateChange={setShowCreateLinkType}
                            canManage={canManageTypes}
                        />
                    )}
                </div>

                <div
                    role="tabpanel"
                    id="panel-eventTemplates"
                    aria-labelledby="tab-eventTemplates"
                    hidden={activeTab !== "eventTemplates"}
                >
                    {activeTab === "eventTemplates" && (
                        <EventTemplateList
                            showCreate={showCreateEventTemplate}
                            onShowCreateChange={setShowCreateEventTemplate}
                            canCreate={canCreateTemplates}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
