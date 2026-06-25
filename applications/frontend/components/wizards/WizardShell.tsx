"use client";

/**
 * WizardShell — reusable multi-step wizard wrapper.
 * Renders inside a Modal with step indicator, back/next/finish buttons.
 */

import { Modal, ModalHeader, ModalContent, ModalFooter } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";

export interface WizardStep {
    label: string;
}

interface WizardShellProps {
    open: boolean;
    onClose: () => void;
    title: string;
    steps: WizardStep[];
    currentStep: number;
    onBack: () => void;
    onNext: () => void;
    nextLabel?: string;
    nextDisabled?: boolean;
    loading?: boolean;
    children: React.ReactNode;
}

export function WizardShell({
    open,
    onClose,
    title,
    steps,
    currentStep,
    onBack,
    onNext,
    nextLabel,
    nextDisabled,
    loading,
    children,
}: WizardShellProps) {
    const isFirst = currentStep === 0;
    const isLast = currentStep === steps.length - 1;

    return (
        <Modal open={open} onClose={onClose}>
            <ModalHeader onClose={onClose}>{title}</ModalHeader>
            <ModalContent>
                {/* Step indicator */}
                <div className="flex items-center gap-1 mb-5">
                    {steps.map((step, i) => (
                        <div key={i} className="flex items-center gap-1 flex-1">
                            <div className={cn(
                                "flex items-center justify-center h-6 w-6 rounded-full text-xs font-semibold shrink-0 transition-colors",
                                i < currentStep
                                    ? "bg-primary text-primary-foreground"
                                    : i === currentStep
                                        ? "bg-primary text-primary-foreground ring-2 ring-primary/30"
                                        : "bg-muted text-muted-foreground"
                            )}>
                                {i < currentStep ? "\u2713" : i + 1}
                            </div>
                            <span className={cn(
                                "text-xs truncate hidden sm:block",
                                i === currentStep ? "text-foreground font-medium" : "text-muted-foreground"
                            )}>
                                {step.label}
                            </span>
                            {i < steps.length - 1 && (
                                <div className={cn(
                                    "flex-1 h-px mx-1",
                                    i < currentStep ? "bg-primary" : "bg-border"
                                )} />
                            )}
                        </div>
                    ))}
                </div>

                {children}
            </ModalContent>
            <ModalFooter>
                {!isFirst && (
                    <Button variant="ghost" onClick={onBack} disabled={loading}>
                        Back
                    </Button>
                )}
                <Button variant="ghost" onClick={onClose} disabled={loading}>
                    Cancel
                </Button>
                <Button
                    variant="primary"
                    onClick={onNext}
                    disabled={nextDisabled}
                    loading={loading}
                >
                    {nextLabel ?? (isLast ? "Create All" : "Next")}
                </Button>
            </ModalFooter>
        </Modal>
    );
}
