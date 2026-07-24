"use client";

import { useCallback, useState } from "react";
import useSWR from "swr";
import { AlertCircle, Loader2, Wand2 } from "lucide-react";
import { Modal, ModalContent, ModalFooter, ModalHeader } from "@/components/ui/Modal";
import { listProjects } from "@/lib/api/projects";
import {
    createAnomalyRule,
    getProjectChannelIds,
    listChannelOptions,
    type AnomalyRuleInput,
    type ChannelOption,
} from "@/lib/api/anomalyRules";
import { ConditionBuilder } from "@/components/ide/condition-builder/ConditionBuilder";

/**
 * Shortcut from the Meldungen page into the graphical condition builder:
 * pick a project, and the builder opens with the channel catalog scoped to
 * that project's assets.
 */
export function AnomalyRuleShortcut() {
    const [dialogOpen, setDialogOpen] = useState(false);
    const [projectId, setProjectId] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [builderChannels, setBuilderChannels] = useState<ChannelOption[] | null>(null);
    const [saved, setSaved] = useState(false);

    const { data: projects } = useSWR(dialogOpen ? "projects" : null, async () => {
        const res = await listProjects();
        return res.projects;
    });

    const openDialog = useCallback(() => {
        setDialogOpen(true);
        setError(null);
        setSaved(false);
    }, []);

    const openBuilder = useCallback(async () => {
        const targetProject = projectId || projects?.[0]?.id;
        if (!targetProject) return;
        setLoading(true);
        setError(null);
        try {
            const [channels, projectChannelIds] = await Promise.all([
                listChannelOptions(),
                getProjectChannelIds(targetProject),
            ]);
            const scoped = channels.filter((c) => projectChannelIds.has(c.metricPointId));
            if (scoped.length === 0) {
                setError("Dieses Projekt hat noch keine Kanäle.");
                return;
            }
            setBuilderChannels(scoped);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Kanäle konnten nicht geladen werden");
        } finally {
            setLoading(false);
        }
    }, [projectId, projects]);

    const handleSave = useCallback(async (input: AnomalyRuleInput) => {
        await createAnomalyRule(input);
        setBuilderChannels(null);
        setDialogOpen(false);
        setSaved(true);
    }, []);

    return (
        <>
            <button
                onClick={openDialog}
                className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
                <Wand2 className="h-4 w-4" />
                Neue Anomalie-Regel
            </button>
            {saved && (
                <p className="text-xs text-emerald-500 mt-1">
                    Regel gespeichert. Sie erscheint am gebundenen Asset und greift innerhalb von 30 Sekunden.
                </p>
            )}

            <Modal open={dialogOpen && builderChannels === null} onClose={() => setDialogOpen(false)}>
                <ModalHeader onClose={() => setDialogOpen(false)}>
                    Anomalie-Regel erstellen
                </ModalHeader>
                <ModalContent>
                    <div className="space-y-2">
                        <label className="text-xs text-muted-foreground block">
                            Projekt wählen, dessen Anlagen die Regel überwachen soll
                        </label>
                        <select
                            value={projectId || projects?.[0]?.id || ""}
                            onChange={(e) => setProjectId(e.target.value)}
                            className="w-full text-sm h-9 px-2 rounded border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        >
                            {(projects ?? []).map((p) => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>
                        {!projects && (
                            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                                <Loader2 className="h-3 w-3 animate-spin" /> Lade Projekte…
                            </p>
                        )}
                        {error && (
                            <p className="text-xs text-red-500 flex items-center gap-1.5">
                                <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {error}
                            </p>
                        )}
                    </div>
                </ModalContent>
                <ModalFooter>
                    <button
                        onClick={() => setDialogOpen(false)}
                        className="text-sm px-3 py-1.5 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                        Abbrechen
                    </button>
                    <button
                        onClick={openBuilder}
                        disabled={loading || !projects || projects.length === 0}
                        className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                    >
                        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                        Builder öffnen
                    </button>
                </ModalFooter>
            </Modal>

            <ConditionBuilder
                open={builderChannels !== null}
                channels={builderChannels ?? []}
                currentAssetId={null}
                initialRule={null}
                onSave={handleSave}
                onClose={() => setBuilderChannels(null)}
            />
        </>
    );
}
