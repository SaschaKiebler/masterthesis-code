/**
 * Relocate Asset Modal
 * Allows a consultant to move an asset to a different site and optionally a space within that site.
 * Telemetry data follows automatically (keyed by immutable device_id).
 */

"use client";

import { useState, useMemo, useCallback } from "react";
import { Modal, ModalHeader, ModalContent, ModalFooter } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { useSites } from "@/lib/hooks/useSites";
import { useSpaces, flattenSpaceTree } from "@/lib/hooks/useSpaces";
import { relocateAsset } from "@/lib/api/assets";
import { ApiError } from "@/lib/api/client";
import type { SiteSummary, SpaceDTO } from "@/lib/api/types";
import { ArrowRightLeft, Search, Building2, MapPin, ChevronRight, Info } from "lucide-react";

interface RelocateAssetModalProps {
    open: boolean;
    onClose: () => void;
    assetId: string;
    assetName: string;
    currentSiteId: string;
    onSuccess: () => void;
}

export function RelocateAssetModal({
    open,
    onClose,
    assetId,
    assetName,
    currentSiteId,
    onSuccess,
}: RelocateAssetModalProps) {
    const { sites, isLoading: sitesLoading } = useSites();

    const [searchQuery, setSearchQuery] = useState("");
    const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
    const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);
    const [isRelocating, setIsRelocating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Fetch spaces for the selected target site
    const { spaces: targetSpaces, isLoading: spacesLoading } = useSpaces(selectedSiteId, "tree");
    const flatSpaces = useMemo(() => flattenSpaceTree(targetSpaces), [targetSpaces]);

    // Filter sites by search query
    const filteredSites = useMemo(() => {
        if (!searchQuery.trim()) return sites;
        const q = searchQuery.toLowerCase();
        return sites.filter(
            (s) =>
                s.name.toLowerCase().includes(q) ||
                (s.address && s.address.toLowerCase().includes(q))
        );
    }, [sites, searchQuery]);

    const selectedSite = useMemo(
        () => sites.find((s) => s.id === selectedSiteId) ?? null,
        [sites, selectedSiteId]
    );

    const isCrossSiteMove = selectedSiteId !== null && selectedSiteId !== currentSiteId;

    const handleClose = useCallback(() => {
        setSelectedSiteId(null);
        setSelectedSpaceId(null);
        setSearchQuery("");
        setError(null);
        onClose();
    }, [onClose]);

    const handleSelectSite = useCallback((siteId: string) => {
        setSelectedSiteId(siteId);
        setSelectedSpaceId(null); // reset space when site changes
        setError(null);
    }, []);

    async function handleRelocate() {
        if (!selectedSiteId) return;

        setIsRelocating(true);
        setError(null);

        try {
            await relocateAsset(assetId, selectedSiteId, selectedSpaceId);
            handleClose();
            onSuccess();
        } catch (err) {
            if (err instanceof ApiError) {
                setError(err.message || "Failed to relocate asset.");
            } else {
                setError("Network error. Please try again.");
            }
        } finally {
            setIsRelocating(false);
        }
    }

    return (
        <Modal open={open} onClose={handleClose} className="md:max-w-xl">
            <ModalHeader onClose={handleClose}>
                Relocate Asset
            </ModalHeader>

            <ModalContent>
                <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                        Move <span className="font-medium text-foreground">{assetName}</span> to a different site or space. All measurement history will follow automatically.
                    </p>

                    {/* Info banner */}
                    <div className="flex gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20">
                        <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                        <p className="text-xs text-muted-foreground">
                            Telemetry data is linked by the immutable device ID, so all historical measurements travel with the asset automatically.
                        </p>
                    </div>

                    {error && (
                        <div className="p-3 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger" role="alert">
                            {error}
                        </div>
                    )}

                    {/* Step 1: Select target site */}
                    <div>
                        <h3 className="text-sm font-medium text-foreground mb-2">1. Select target site</h3>

                        <div className="relative mb-2">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                            <input
                                type="text"
                                placeholder="Search sites..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                            />
                        </div>

                        <div className="max-h-48 overflow-y-auto space-y-1">
                            {sitesLoading ? (
                                <p className="text-sm text-muted-foreground text-center py-4">Loading sites...</p>
                            ) : filteredSites.length === 0 ? (
                                <p className="text-sm text-muted-foreground text-center py-4">No sites found.</p>
                            ) : (
                                filteredSites.map((site) => (
                                    <SiteOption
                                        key={site.id}
                                        site={site}
                                        isSelected={selectedSiteId === site.id}
                                        isCurrent={site.id === currentSiteId}
                                        onSelect={() => handleSelectSite(site.id)}
                                    />
                                ))
                            )}
                        </div>
                    </div>

                    {/* Step 2: Optionally select target space (only shown once a site is selected) */}
                    {selectedSiteId && (
                        <div>
                            <h3 className="text-sm font-medium text-foreground mb-2">
                                2. Select target space <span className="text-muted-foreground font-normal">(optional)</span>
                            </h3>

                            {spacesLoading ? (
                                <p className="text-sm text-muted-foreground text-center py-3">Loading spaces...</p>
                            ) : flatSpaces.length === 0 ? (
                                <p className="text-sm text-muted-foreground text-center py-3 bg-muted/30 rounded-lg">
                                    No spaces defined for this site.
                                </p>
                            ) : (
                                <div className="max-h-40 overflow-y-auto space-y-1">
                                    {/* "No space" option */}
                                    <button
                                        type="button"
                                        onClick={() => setSelectedSpaceId(null)}
                                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors border ${
                                            selectedSpaceId === null
                                                ? "border-primary bg-primary/5 text-foreground"
                                                : "border-transparent hover:bg-muted/30 text-muted-foreground"
                                        }`}
                                    >
                                        No specific space
                                    </button>
                                    {flatSpaces.map((node) => (
                                        <button
                                            key={node.space.id}
                                            type="button"
                                            onClick={() => setSelectedSpaceId(node.space.id)}
                                            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors border ${
                                                selectedSpaceId === node.space.id
                                                    ? "border-primary bg-primary/5 text-foreground"
                                                    : "border-transparent hover:bg-muted/30 text-muted-foreground"
                                            }`}
                                            style={{ paddingLeft: `${12 + node.depth * 16}px` }}
                                        >
                                            <div className="flex items-center gap-1.5">
                                                {node.depth > 0 && (
                                                    <ChevronRight className="h-3 w-3 text-muted-foreground/50" aria-hidden="true" />
                                                )}
                                                <span>{node.space.name}</span>
                                                <Badge variant="secondary" size="sm">
                                                    {node.space.type}
                                                </Badge>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Summary */}
                    {selectedSite && (
                        <div className="p-3 rounded-lg border border-border bg-muted/20 space-y-1">
                            <p className="text-xs font-medium text-muted-foreground">Summary</p>
                            <div className="flex items-center gap-2 text-sm">
                                <span className="text-foreground">{assetName}</span>
                                <ArrowRightLeft className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                                <span className="text-foreground font-medium">{selectedSite.name}</span>
                            </div>
                            {selectedSpaceId && (
                                <p className="text-xs text-muted-foreground">
                                    Space: {flatSpaces.find((n) => n.space.id === selectedSpaceId)?.path ?? selectedSpaceId}
                                </p>
                            )}
                            {isCrossSiteMove && (
                                <p className="text-xs text-warning mt-1">
                                    Cross-site move: the current space assignment will be cleared{selectedSpaceId ? " and replaced with the selected space" : ""}.
                                </p>
                            )}
                        </div>
                    )}
                </div>
            </ModalContent>

            <ModalFooter>
                <Button type="button" variant="ghost" onClick={handleClose} disabled={isRelocating}>
                    Cancel
                </Button>
                <Button
                    type="button"
                    variant="primary"
                    onClick={handleRelocate}
                    disabled={!selectedSiteId || isRelocating}
                    loading={isRelocating}
                >
                    <ArrowRightLeft className="h-4 w-4 mr-1" aria-hidden="true" />
                    {isRelocating ? "Moving..." : "Move Asset"}
                </Button>
            </ModalFooter>
        </Modal>
    );
}

function SiteOption({
    site,
    isSelected,
    isCurrent,
    onSelect,
}: {
    site: SiteSummary;
    isSelected: boolean;
    isCurrent: boolean;
    onSelect: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onSelect}
            className={`w-full text-left p-3 rounded-lg border transition-colors ${
                isSelected
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/30 hover:bg-muted/30"
            }`}
        >
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
                        <span className="text-sm font-medium text-foreground truncate">
                            {site.name}
                        </span>
                        {isCurrent && (
                            <Badge variant="secondary" size="sm">current</Badge>
                        )}
                    </div>
                    {site.address && (
                        <div className="flex items-center gap-1 mt-0.5 ml-6">
                            <MapPin className="h-3 w-3 text-muted-foreground shrink-0" aria-hidden="true" />
                            <p className="text-xs text-muted-foreground truncate">{site.address}</p>
                        </div>
                    )}
                </div>
                <Badge variant="default" size="sm">
                    {site.assetCount} {site.assetCount === 1 ? "asset" : "assets"}
                </Badge>
            </div>
        </button>
    );
}
