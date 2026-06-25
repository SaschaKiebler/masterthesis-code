/**
 * Asset Information Card
 * Displays asset metadata with inline edit mode for name and type.
 * Uses PATCH /api/v1/assets/{id} for partial updates.
 */

"use client";

import { useState, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { updateAsset } from "@/lib/api/assets";
import { ApiError } from "@/lib/api/client";
import { Pencil, X, Save } from "lucide-react";
import type { Asset } from "@/lib/api/types";

interface AssetInfoCardProps {
    asset: Asset;
    onUpdate: () => void;
}

export function AssetInfoCard({ asset, onUpdate }: AssetInfoCardProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [editName, setEditName] = useState("");
    const [editType, setEditType] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const startEditing = useCallback(() => {
        setEditName(asset.name || "");
        setEditType(asset.type || "");
        setIsEditing(true);
        setError(null);
    }, [asset.name, asset.type]);

    const cancelEditing = useCallback(() => {
        setIsEditing(false);
        setError(null);
    }, []);

    async function handleSave() {
        const trimmedName = editName.trim();
        const trimmedType = editType.trim();

        if (!trimmedName) {
            setError("Asset name is required.");
            return;
        }

        setIsSaving(true);
        setError(null);
        try {
            const updates: { name?: string; type?: string } = {};
            if (trimmedName !== asset.name) updates.name = trimmedName;
            if (trimmedType !== asset.type) updates.type = trimmedType;

            if (Object.keys(updates).length === 0) {
                setIsEditing(false);
                return;
            }

            await updateAsset(asset.id, updates);
            setIsEditing(false);
            onUpdate();
        } catch (err) {
            if (err instanceof ApiError) {
                setError(err.message || "Failed to update asset.");
            } else {
                setError("Network error. Please try again.");
            }
        } finally {
            setIsSaving(false);
        }
    }

    return (
        <Card variant="elevated" className="lg:col-span-2">
            <CardHeader>
                <div className="flex items-center justify-between">
                    <CardTitle>Asset Information</CardTitle>
                    {isEditing ? (
                        <div className="flex gap-1.5">
                            <Button variant="ghost" size="sm" onClick={cancelEditing} disabled={isSaving}>
                                <X className="h-4 w-4 mr-1" aria-hidden="true" />
                                Cancel
                            </Button>
                            <Button variant="primary" size="sm" onClick={handleSave} loading={isSaving}>
                                <Save className="h-4 w-4 mr-1" aria-hidden="true" />
                                {isSaving ? "Saving..." : "Save"}
                            </Button>
                        </div>
                    ) : (
                        <Button variant="ghost" size="sm" onClick={startEditing}>
                            <Pencil className="h-4 w-4 mr-1" aria-hidden="true" />
                            Edit
                        </Button>
                    )}
                </div>
            </CardHeader>
            <CardContent>
                {error && (
                    <div className="p-3 mb-4 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger" role="alert">
                        {error}
                    </div>
                )}

                {isEditing ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Input
                            label="Name"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            placeholder="Asset name"
                        />
                        <Input
                            label="Type"
                            value={editType}
                            onChange={(e) => setEditType(e.target.value)}
                            placeholder="e.g. ENERGY_METER"
                        />

                        <div>
                            <p className="text-sm text-muted-foreground mb-1">Asset ID</p>
                            <p className="font-mono text-sm text-foreground break-all">{asset.id}</p>
                        </div>

                        <div>
                            <p className="text-sm text-muted-foreground mb-1">Device ID</p>
                            <p className="font-mono text-sm text-foreground break-all">{asset.deviceId}</p>
                        </div>

                        {asset.modelHuman && (
                            <div>
                                <p className="text-sm text-muted-foreground mb-1">Model</p>
                                <p className="text-sm text-foreground">{asset.modelHuman}</p>
                            </div>
                        )}

                        <div>
                            <p className="text-sm text-muted-foreground mb-1">Site ID</p>
                            <p className="font-mono text-sm text-foreground break-all">{asset.siteId}</p>
                        </div>

                        {asset.spaceId && (
                            <div>
                                <p className="text-sm text-muted-foreground mb-1">Space ID</p>
                                <p className="font-mono text-sm text-foreground break-all">{asset.spaceId}</p>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <p className="text-sm text-muted-foreground mb-1">Asset ID</p>
                            <p className="font-mono text-sm text-foreground break-all">{asset.id}</p>
                        </div>

                        <div>
                            <p className="text-sm text-muted-foreground mb-1">Device ID</p>
                            <p className="font-mono text-sm text-foreground break-all">{asset.deviceId}</p>
                        </div>

                        <div>
                            <p className="text-sm text-muted-foreground mb-1">Name</p>
                            <p className="text-sm font-medium text-foreground">{asset.name}</p>
                        </div>

                        <div>
                            <p className="text-sm text-muted-foreground mb-1">Type</p>
                            <Badge variant="primary">{asset.type}</Badge>
                        </div>

                        {asset.modelHuman && (
                            <div>
                                <p className="text-sm text-muted-foreground mb-1">Model</p>
                                <p className="text-sm text-foreground">{asset.modelHuman}</p>
                            </div>
                        )}

                        <div>
                            <p className="text-sm text-muted-foreground mb-1">Site ID</p>
                            <p className="font-mono text-sm text-foreground break-all">{asset.siteId}</p>
                        </div>

                        {asset.spaceId && (
                            <div>
                                <p className="text-sm text-muted-foreground mb-1">Space ID</p>
                                <p className="font-mono text-sm text-foreground break-all">{asset.spaceId}</p>
                            </div>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
