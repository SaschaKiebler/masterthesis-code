/**
 * Modal Component
 * Desktop: Centered modal with overlay
 * Mobile: Bottom sheet (slides up from bottom) with drag handle
 * Follows UI/UX guidelines: Escape to close, focus trap, ARIA, body scroll lock
 */

"use client";

import { cn } from "@/lib/utils/cn";
import { useEffect, useRef, useCallback } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";

interface ModalProps {
    open: boolean;
    onClose: () => void;
    children: ReactNode;
    className?: string;
}

export function Modal({ open, onClose, children, className }: ModalProps) {
    const modalRef = useRef<HTMLDivElement>(null);
    const previousFocusRef = useRef<HTMLElement | null>(null);
    const onCloseRef = useRef(onClose);

    // Keep onClose ref current without causing effect re-runs
    onCloseRef.current = onClose;

    const handleKeyDown = useCallback(
        (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onCloseRef.current();
                return;
            }

            // Focus trap
            if (e.key === "Tab" && modalRef.current) {
                const focusable = modalRef.current.querySelectorAll<HTMLElement>(
                    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
                );
                const first = focusable[0];
                const last = focusable[focusable.length - 1];

                if (e.shiftKey) {
                    if (document.activeElement === first) {
                        e.preventDefault();
                        last?.focus();
                    }
                } else {
                    if (document.activeElement === last) {
                        e.preventDefault();
                        first?.focus();
                    }
                }
            }
        },
        []
    );

    useEffect(() => {
        if (open) {
            previousFocusRef.current = document.activeElement as HTMLElement;
            document.addEventListener("keydown", handleKeyDown);
            document.body.style.overflow = "hidden";

            // Focus first focusable element only once on open
            requestAnimationFrame(() => {
                const first = modalRef.current?.querySelector<HTMLElement>(
                    'input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])'
                );
                first?.focus();
            });
        }

        return () => {
            document.removeEventListener("keydown", handleKeyDown);
            document.body.style.overflow = "";
            previousFocusRef.current?.focus();
        };
    }, [open, handleKeyDown]);

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-60 flex items-end md:items-center justify-center"
            role="presentation"
        >
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/50 animate-backdrop"
                onClick={onClose}
                aria-hidden="true"
            />

            {/* Modal panel */}
            <div
                ref={modalRef}
                role="dialog"
                aria-modal="true"
                className={cn(
                    // Base
                    "relative z-10 bg-card text-card-foreground w-full",
                    "shadow-xl overflow-y-auto",
                    // Mobile: bottom sheet (max 85vh so user sees backdrop)
                    "max-h-[85vh] rounded-t-2xl animate-sheet-up",
                    // Desktop: centered modal with scale animation
                    "md:max-h-[90vh] md:rounded-xl md:max-w-lg md:mx-4 md:animate-modal-in",
                    className
                )}
            >
                {/* Drag handle — mobile only */}
                <div className="flex justify-center pt-3 pb-1 md:hidden" aria-hidden="true">
                    <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
                </div>
                {children}
            </div>
        </div>
    );
}

interface ModalHeaderProps {
    children: ReactNode;
    onClose: () => void;
    className?: string;
}

export function ModalHeader({ children, onClose, className }: ModalHeaderProps) {
    return (
        <div
            className={cn(
                "flex items-center justify-between px-4 pb-4 pt-2 md:p-6 border-b border-border",
                className
            )}
        >
            <h2 className="text-lg font-semibold text-foreground">{children}</h2>
            <button
                onClick={onClose}
                className="p-2 -mr-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors touch-target-sm"
                aria-label="Close modal"
            >
                <X className="h-5 w-5" aria-hidden="true" />
            </button>
        </div>
    );
}

interface ModalContentProps {
    children: ReactNode;
    className?: string;
}

export function ModalContent({ children, className }: ModalContentProps) {
    return (
        <div className={cn("px-4 py-4 md:px-6 md:py-5", className)}>
            {children}
        </div>
    );
}

interface ModalFooterProps {
    children: ReactNode;
    className?: string;
}

export function ModalFooter({ children, className }: ModalFooterProps) {
    return (
        <div
            className={cn(
                "flex flex-col-reverse gap-2 px-4 py-4 md:px-6 md:py-5",
                "sm:flex-row sm:justify-end",
                "border-t border-border safe-bottom",
                className
            )}
        >
            {children}
        </div>
    );
}
