/**
 * Input Component
 * Form input with label, error, and helper text
 * Follows UI/UX guidelines: 16px min font on mobile, touch targets, ARIA
 */

"use client";

import { cn } from "@/lib/utils/cn";
import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
    label: string;
    error?: string;
    helperText?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
    function Input({ label, error, helperText, className, id, required, ...props }, ref) {
        const inputId = id || `input-${label.toLowerCase().replace(/\s+/g, "-")}`;
        const errorId = `${inputId}-error`;
        const helperId = `${inputId}-helper`;

        return (
            <div className="space-y-1.5">
                <label
                    htmlFor={inputId}
                    className="block text-sm font-medium text-foreground"
                >
                    {label}
                    {required && (
                        <span className="text-danger ml-1" aria-hidden="true">*</span>
                    )}
                </label>
                <input
                    ref={ref}
                    id={inputId}
                    required={required}
                    aria-invalid={!!error}
                    aria-describedby={
                        [error ? errorId : null, helperText ? helperId : null]
                            .filter(Boolean)
                            .join(" ") || undefined
                    }
                    className={cn(
                        "block w-full rounded-lg border bg-card px-3 py-2.5",
                        "text-foreground placeholder:text-muted-foreground",
                        "transition-colors duration-200",
                        "focus:outline-none focus:ring-2 focus:ring-offset-0",
                        "disabled:opacity-50 disabled:cursor-not-allowed",
                        "touch-target-sm",
                        error
                            ? "border-danger focus:ring-danger/50"
                            : "border-input focus:ring-primary/50 focus:border-primary",
                        className
                    )}
                    {...props}
                />
                {error && (
                    <p id={errorId} className="text-sm text-danger" role="alert">
                        {error}
                    </p>
                )}
                {helperText && !error && (
                    <p id={helperId} className="text-sm text-muted-foreground">
                        {helperText}
                    </p>
                )}
            </div>
        );
    }
);
