import { createContext, useContext } from "react";
import type { ChannelOption } from "@/lib/api/anomalyRules";
import type { ConditionNodeData, GroupNodeData } from "./graph-model";

/**
 * Shared by the builder canvas and its custom nodes: the channel catalog for
 * the pickers and the callback nodes use to write their field changes back
 * into React Flow's node state.
 */
export interface BuilderContextValue {
    channels: ChannelOption[];
    updateNode: (id: string, patch: Partial<ConditionNodeData & GroupNodeData>) => void;
}

export const BuilderContext = createContext<BuilderContextValue>({
    channels: [],
    updateNode: () => {},
});

export function useBuilder(): BuilderContextValue {
    return useContext(BuilderContext);
}
