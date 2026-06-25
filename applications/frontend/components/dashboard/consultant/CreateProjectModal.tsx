"use client";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal, ModalHeader, ModalContent, ModalFooter } from "@/components/ui/Modal";

export function CreateProjectModal({
    open,
    onClose,
    activeTenant,
    availableTenants,
    selectedTenantId,
    setSelectedTenantId,
    createName,
    setCreateName,
    createDesc,
    setCreateDesc,
    creating,
    createError,
    onSubmit,
}: {
    open: boolean;
    onClose: () => void;
    activeTenant: { id: string; name: string } | null;
    availableTenants: { id: string; name: string }[];
    selectedTenantId: string;
    setSelectedTenantId: (id: string) => void;
    createName: string;
    setCreateName: (v: string) => void;
    createDesc: string;
    setCreateDesc: (v: string) => void;
    creating: boolean;
    createError: string | null;
    onSubmit: () => void;
}) {
    return (
        <Modal open={open} onClose={onClose}>
            <ModalHeader onClose={onClose}>New Project</ModalHeader>
            <ModalContent>
                <div className="space-y-4">
                    {!activeTenant && availableTenants.length > 0 && (
                        <div>
                            <label className="block text-sm font-medium text-foreground mb-1.5">
                                Tenant
                            </label>
                            <select
                                value={selectedTenantId || availableTenants[0]?.id || ""}
                                onChange={(e) => setSelectedTenantId(e.target.value)}
                                className="w-full h-9 px-3 text-sm bg-background border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                            >
                                {availableTenants.map((t) => (
                                    <option key={t.id} value={t.id}>{t.name}</option>
                                ))}
                            </select>
                        </div>
                    )}
                    <Input
                        label="Project Name"
                        placeholder="e.g. Musterstr. Housing Coop"
                        value={createName}
                        onChange={(e) => setCreateName(e.target.value)}
                        error={createError ?? undefined}
                        autoFocus
                        onKeyDown={(e) => { if (e.key === "Enter") onSubmit(); }}
                    />
                    <Input
                        label="Description (optional)"
                        placeholder="e.g. 16 row houses, shared district heating"
                        value={createDesc}
                        onChange={(e) => setCreateDesc(e.target.value)}
                    />
                </div>
            </ModalContent>
            <ModalFooter>
                <Button variant="ghost" onClick={onClose}>Cancel</Button>
                <Button
                    variant="primary"
                    onClick={onSubmit}
                    loading={creating}
                    disabled={!createName.trim()}
                >
                    Create & Open
                </Button>
            </ModalFooter>
        </Modal>
    );
}
