/**
 * DiscoveryToTemplateModal — Bridges discovery analysis to DeviceTemplateModal.
 * Converts SuggestedSignal[] into SignalEntry[] and opens DeviceTemplateModal
 * with pre-filled values from the discovery analysis.
 */

"use client";

import { DeviceTemplateModal } from "@/components/templates/DeviceTemplateModal";
import type { PayloadAnalysis, ObjectType } from "@/lib/api/types";
import type { SignalEntry } from "@/lib/utils/signal-map";

interface DiscoveryToTemplateModalProps {
    open: boolean;
    onClose: () => void;
    onSuccess: () => void;
    analysis: PayloadAnalysis;
    deviceId: string;
    objectTypes: ObjectType[];
}

export function DiscoveryToTemplateModal({
    open,
    onClose,
    onSuccess,
    analysis,
    deviceId,
    objectTypes,
}: DiscoveryToTemplateModalProps) {
    const signalEntries: SignalEntry[] = analysis.suggestedSignalMap.map((signal) => ({
        metricId: signal.metricId,
        name: signal.name,
        unit: signal.unit,
        min: "",
        max: "",
        source: signal.source,
        field: signal.field,
    }));

    return (
        <DeviceTemplateModal
            open={open}
            onClose={onClose}
            onSuccess={onSuccess}
            objectTypes={objectTypes}
            initialProtocol={analysis.detectedProtocol}
            initialSignalEntries={signalEntries}
            initialManufacturer={deviceId.includes("-") ? deviceId.split("-")[0] : undefined}
        />
    );
}
