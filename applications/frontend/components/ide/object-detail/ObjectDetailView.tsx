"use client";

import { useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/Button";
import { useDashboards } from "@/lib/hooks/useDashboards";
import type { GraphObject, GraphLink, ApiLinkType, CreateLinkRequest } from "@/lib/api/types";
import { Cpu, Trash2, Copy, Plus, X, Check, Pencil, ClipboardList } from "lucide-react";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { LogEventModal } from "@/components/events/LogEventModal";
import { DeviceConfigSection, isDeviceCategory } from "../device-config";
import { CreateDashboardDialog } from "@/components/dashboard/CreateDashboardDialog";
import { ICON_MAP, CATEGORY_COLOR, CATEGORY_BG } from "./constants";
import { Section, InfoRow } from "./Section";
import { LinkRow } from "./LinkRow";
import { AddLinkInline } from "./AddLinkInline";
import { DashboardsSection } from "./DashboardsSection";
import { DeviceAlertRulesSection } from "./DeviceAlertRulesSection";
import { KpiFormulasSection } from "./KpiFormulasSection";
import { SpecificationsSection } from "./SpecificationsSection";

// ─── Object detail view ───────────────────────────────────────────────────────

export interface ObjectDetailViewProps {
    projectId: string;
    object: GraphObject;
    allObjects: GraphObject[];
    allLinks: GraphLink[];
    linkTypes: ApiLinkType[];
    onUpdateName: (objectId: string, displayName: string) => Promise<void>;
    onDeleteObject?: (objectId: string) => Promise<void>;
    onCreateLink: (data: CreateLinkRequest) => Promise<void>;
    onDeleteLink: (linkId: string) => Promise<void>;
    onSelectObject: (object: GraphObject | null) => void;
}

export function ObjectDetailView({
    projectId,
    object,
    allObjects,
    allLinks,
    linkTypes,
    onUpdateName,
    onDeleteObject,
    onCreateLink,
    onDeleteLink,
    onSelectObject,
}: ObjectDetailViewProps) {
    const router = useRouter();
    const [editingName, setEditingName] = useState(false);
    const [nameValue, setNameValue] = useState(object.displayName);
    const [saving, setSaving] = useState(false);
    const [showAddLink, setShowAddLink] = useState(false);
    const [copiedId, setCopiedId] = useState(false);
    const [showCreateDashboard, setShowCreateDashboard] = useState(false);
    const [showLogEvent, setShowLogEvent] = useState(false);
    const { dashboards, loading: dashboardsLoading } = useDashboards(projectId);

    // Reset name when object changes
    const currentId = object.id;
    if (nameValue !== object.displayName && !editingName) {
        setNameValue(object.displayName);
    }

    const Icon = ICON_MAP[object.objectTypeName] ?? Cpu;
    const iconColor = CATEGORY_COLOR[object.objectTypeCategory] ?? "text-muted-foreground";
    const catBg = CATEGORY_BG[object.objectTypeCategory] ?? "bg-muted text-muted-foreground";

    // Gather links for this object
    const outboundLinks = useMemo(
        () => allLinks.filter((l) => l.sourceId === object.id),
        [allLinks, object.id]
    );
    const inboundLinks = useMemo(
        () => allLinks.filter((l) => l.targetId === object.id),
        [allLinks, object.id]
    );

    const handleSaveName = useCallback(async () => {
        if (!nameValue.trim() || nameValue.trim() === object.displayName) {
            setEditingName(false);
            return;
        }
        setSaving(true);
        try {
            await onUpdateName(object.id, nameValue.trim());
            setEditingName(false);
        } catch { /* handled upstream */ }
        finally { setSaving(false); }
    }, [nameValue, object, onUpdateName]);

    const handleCopyId = useCallback(() => {
        navigator.clipboard.writeText(object.id);
        setCopiedId(true);
        setTimeout(() => setCopiedId(false), 1500);
    }, [object.id]);

    const handleDelete = useCallback(async () => {
        if (!onDeleteObject) return;
        if (!confirm(`Delete "${object.displayName}"? All links will be removed.`)) return;
        await onDeleteObject(object.id);
    }, [object, onDeleteObject]);

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <div className="flex-1 overflow-y-auto">
                {/* Header */}
                <div className="px-4 pt-4 pb-3 border-b border-border">
                    <div className="flex items-center gap-2.5">
                        <div className={cn("p-1.5 rounded-lg", catBg)}>
                            <Icon className="h-5 w-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                            {editingName ? (
                                <div className="flex items-center gap-1">
                                    <input
                                        value={nameValue}
                                        onChange={(e) => setNameValue(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") handleSaveName();
                                            if (e.key === "Escape") { setEditingName(false); setNameValue(object.displayName); }
                                        }}
                                        autoFocus
                                        className="flex-1 h-7 px-2 text-sm font-semibold bg-background border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                    />
                                    <button onClick={handleSaveName} disabled={saving} className="p-1 rounded text-primary hover:bg-primary/10 transition-colors">
                                        <Check className="h-3.5 w-3.5" />
                                    </button>
                                    <button onClick={() => { setEditingName(false); setNameValue(object.displayName); }} className="p-1 rounded text-muted-foreground hover:bg-muted transition-colors">
                                        <X className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            ) : (
                                <button
                                    onClick={() => setEditingName(true)}
                                    className="group flex items-center gap-1.5 text-left"
                                >
                                    <span className="text-sm font-semibold text-foreground truncate">
                                        {object.displayName}
                                    </span>
                                    <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                                </button>
                            )}
                            <p className="text-xs text-muted-foreground mt-0.5">
                                {object.objectTypeDisplayName}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Info section */}
                <Section title="Info">
                    <InfoRow label="Type" value={object.objectTypeDisplayName || object.objectTypeName.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()).replace(/\B\w+/g, w => w.toLowerCase())} />
                    <InfoRow label="Category">
                        <span className={cn("text-xs font-medium px-1.5 py-0.5 rounded", catBg)}>
                            {object.objectTypeCategory.charAt(0) + object.objectTypeCategory.slice(1).toLowerCase()}
                        </span>
                    </InfoRow>
                    <InfoRow label="ID">
                        <button
                            onClick={handleCopyId}
                            className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors"
                            title="Copy to clipboard"
                        >
                            <span className="truncate max-w-[180px]">{object.id}</span>
                            {copiedId ? <Check className="h-3 w-3 text-emerald-500 shrink-0" /> : <Copy className="h-3 w-3 shrink-0" />}
                        </button>
                    </InfoRow>
                </Section>

                {/* Specifications section — custom properties (ADR-014) */}
                <SpecificationsSection
                    objectId={object.id}
                    propertySchemaJson={object.objectTypePropertySchema}
                    propertiesJson={object.properties}
                />

                {/* Device Config section (only for device-category objects) */}
                {isDeviceCategory(object.objectTypeCategory) && (
                    <DeviceConfigSection
                        objectId={object.id}
                        objectTypeName={object.objectTypeName}
                        objectTypeCategory={object.objectTypeCategory}
                    />
                )}

                {/* Alert Rules section (only for device-category objects) */}
                {isDeviceCategory(object.objectTypeCategory) && (
                    <DeviceAlertRulesSection objectId={object.id} />
                )}

                {/* KPI Formulas section — available for all object types */}
                <KpiFormulasSection
                    objectId={object.id}
                    projectId={projectId}
                    objectTypeName={object.objectTypeName}
                    objectDisplayName={object.displayName}
                />

                {/* Dashboards section */}
                <DashboardsSection
                    projectId={projectId}
                    object={object}
                    dashboards={dashboards}
                    loading={dashboardsLoading}
                    onEdit={(dashboardId: string) => router.push(`/projects/${projectId}/dashboards/${dashboardId}/edit`)}
                    onCreateNew={() => setShowCreateDashboard(true)}
                />

                {/* Links section */}
                <Section title="Connections" tooltip="Connections show how items relate — e.g. a sensor monitors a room, or a floor belongs to a building." count={outboundLinks.length + inboundLinks.length} action={
                    <button
                        onClick={() => setShowAddLink(!showAddLink)}
                        className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                        <Plus className="h-3.5 w-3.5" />
                    </button>
                }>
                    {showAddLink && (
                        <AddLinkInline
                            sourceObject={object}
                            allObjects={allObjects}
                            linkTypes={linkTypes}
                            onCreateLink={onCreateLink}
                            onClose={() => setShowAddLink(false)}
                        />
                    )}

                    {outboundLinks.length === 0 && inboundLinks.length === 0 && !showAddLink && (
                        <p className="text-xs text-muted-foreground py-2">No connections yet.</p>
                    )}

                    {outboundLinks.map((link) => (
                        <LinkRow
                            key={link.id}
                            link={link}
                            direction="outbound"
                            onDelete={() => onDeleteLink(link.id)}
                            onNavigate={() => {
                                const target = allObjects.find((o) => o.id === link.targetId);
                                if (target) onSelectObject(target);
                            }}
                        />
                    ))}

                    {inboundLinks.map((link) => (
                        <LinkRow
                            key={link.id}
                            link={link}
                            direction="inbound"
                            onDelete={() => onDeleteLink(link.id)}
                            onNavigate={() => {
                                const source = allObjects.find((o) => o.id === link.sourceId);
                                if (source) onSelectObject(source);
                            }}
                        />
                    ))}
                </Section>
            </div>

            {/* Actions footer */}
            <div className="border-t border-border px-4 py-3 shrink-0 flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setEditingName(true)}>
                    <Pencil className="h-3.5 w-3.5 mr-1.5" /> Rename
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowLogEvent(true)}>
                    <ClipboardList className="h-3.5 w-3.5 mr-1.5" /> Log Event
                </Button>
                {onDeleteObject && (
                    <Button size="sm" variant="danger" onClick={handleDelete}>
                        <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete
                    </Button>
                )}
            </div>

            <CreateDashboardDialog
                open={showCreateDashboard}
                onClose={() => setShowCreateDashboard(false)}
                projectId={projectId}
                selectedObject={object}
                allObjects={allObjects}
                allLinks={allLinks}
                onCreated={(dashboardId) => router.push(`/projects/${projectId}/dashboards/${dashboardId}/edit`)}
            />

            <LogEventModal
                open={showLogEvent}
                onClose={() => setShowLogEvent(false)}
                objects={allObjects}
                preselectedObjectId={object.id}
            />
        </div>
    );
}
