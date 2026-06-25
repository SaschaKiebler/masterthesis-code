"use client";

/**
 * ObjectDetailPanel — right panel of the IDE.
 * Shows full details for the selected object or link.
 * When nothing is selected, shows a project summary placeholder.
 */

import type { GraphObject, GraphLink, ApiLinkType, CreateLinkRequest } from "@/lib/api/types";
import { ObjectDetailView } from "./object-detail/ObjectDetailView";
import { LinkDetailView } from "./object-detail/LinkDetailView";
import { EmptyState } from "./object-detail/EmptyState";

// ─── Props ────────────────────────────────────────────────────────────────────

interface ObjectDetailPanelProps {
    projectId: string;
    selectedObject: GraphObject | null;
    selectedLink: GraphLink | null;
    allObjects: GraphObject[];
    allLinks: GraphLink[];
    linkTypes: ApiLinkType[];
    onUpdateName: (objectId: string, displayName: string) => Promise<void>;
    onDeleteObject?: (objectId: string) => Promise<void>;
    onCreateLink: (data: CreateLinkRequest) => Promise<void>;
    onDeleteLink: (linkId: string) => Promise<void>;
    onSelectObject: (object: GraphObject | null) => void;
    onSetupBuilding?: () => void;
    onAddSensor?: () => void;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ObjectDetailPanel({
    projectId,
    selectedObject,
    selectedLink,
    allObjects,
    allLinks,
    linkTypes,
    onUpdateName,
    onDeleteObject,
    onCreateLink,
    onDeleteLink,
    onSelectObject,
    onSetupBuilding,
    onAddSensor,
}: ObjectDetailPanelProps) {
    if (selectedLink && !selectedObject) {
        return <LinkDetailView link={selectedLink} onDeleteLink={onDeleteLink} allObjects={allObjects} onSelectObject={onSelectObject} />;
    }

    if (selectedObject) {
        return (
            <ObjectDetailView
                projectId={projectId}
                object={selectedObject}
                allObjects={allObjects}
                allLinks={allLinks}
                linkTypes={linkTypes}
                onUpdateName={onUpdateName}
                onDeleteObject={onDeleteObject}
                onCreateLink={onCreateLink}
                onDeleteLink={onDeleteLink}
                onSelectObject={onSelectObject}
            />
        );
    }

    return (
        <EmptyState
            objectCount={allObjects.length}
            linkCount={allLinks.length}
            onSetupBuilding={onSetupBuilding}
            onAddSensor={onAddSensor}
        />
    );
}
