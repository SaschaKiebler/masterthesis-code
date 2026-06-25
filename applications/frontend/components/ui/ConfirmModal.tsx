"use client";

import { Modal, ModalHeader, ModalContent, ModalFooter } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { AlertTriangle } from "lucide-react";

interface ConfirmModalProps {
    open: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    message: string;
    detail?: string;
    confirmLabel?: string;
    loading?: boolean;
    error?: string | null;
}

export function ConfirmModal({
    open,
    onClose,
    onConfirm,
    title,
    message,
    detail,
    confirmLabel = "Delete",
    loading = false,
    error = null,
}: ConfirmModalProps) {
    return (
        <Modal open={open} onClose={() => { if (!loading) onClose(); }}>
            <ModalHeader onClose={() => { if (!loading) onClose(); }}>
                {title}
            </ModalHeader>
            <ModalContent>
                <div className="flex gap-3">
                    <div className="p-2 rounded-full bg-danger/10 h-fit">
                        <AlertTriangle className="h-5 w-5 text-danger" />
                    </div>
                    <div>
                        <p className="text-sm text-foreground">{message}</p>
                        {detail && (
                            <p className="text-sm text-muted-foreground mt-1">{detail}</p>
                        )}
                        {error && (
                            <p className="text-sm text-danger mt-2">{error}</p>
                        )}
                    </div>
                </div>
            </ModalContent>
            <ModalFooter>
                <Button variant="ghost" onClick={onClose} disabled={loading}>
                    Cancel
                </Button>
                <Button variant="danger" onClick={onConfirm} loading={loading}>
                    {confirmLabel}
                </Button>
            </ModalFooter>
        </Modal>
    );
}
