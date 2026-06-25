/**
 * InfoTooltip — small (i) icon that reveals explanatory text on hover/tap.
 * Uses fixed positioning via a portal so tooltips are never clipped by
 * parent overflow or narrow containers.
 */

"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";

interface InfoTooltipProps {
    /** The help text to display */
    text: string;
    /** Optional size override (default: 14px icon) */
    size?: "sm" | "md";
    /** Position preference */
    side?: "top" | "bottom" | "left" | "right";
}

export function InfoTooltip({ text, size = "sm", side = "bottom" }: InfoTooltipProps) {
    const [open, setOpen] = useState(false);
    const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
    const iconRef = useRef<HTMLSpanElement>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);

    const iconSize = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";

    const updatePosition = useCallback(() => {
        if (!iconRef.current) return;
        const rect = iconRef.current.getBoundingClientRect();
        const gap = 8;
        let top = 0;
        let left = 0;

        switch (side) {
            case "bottom":
                top = rect.bottom + gap;
                left = rect.left + rect.width / 2;
                break;
            case "top":
                top = rect.top - gap;
                left = rect.left + rect.width / 2;
                break;
            case "right":
                top = rect.top + rect.height / 2;
                left = rect.right + gap;
                break;
            case "left":
                top = rect.top + rect.height / 2;
                left = rect.left - gap;
                break;
        }
        setCoords({ top, left });
    }, [side]);

    // Close on outside click (mobile)
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (
                iconRef.current && !iconRef.current.contains(e.target as Node) &&
                tooltipRef.current && !tooltipRef.current.contains(e.target as Node)
            ) {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [open]);

    const handleOpen = () => {
        updatePosition();
        setOpen(true);
    };

    // Compute transform so the tooltip is centered on the anchor
    const getTransform = () => {
        switch (side) {
            case "bottom":
            case "top":
                return side === "top"
                    ? "translate(-50%, -100%)"
                    : "translate(-50%, 0)";
            case "left":
                return "translate(-100%, -50%)";
            case "right":
                return "translate(0, -50%)";
        }
    };

    return (
        <span
            ref={iconRef}
            className="inline-flex items-center"
            onMouseEnter={handleOpen}
            onMouseLeave={() => setOpen(false)}
            onClick={(e) => {
                e.stopPropagation();
                if (open) setOpen(false);
                else handleOpen();
            }}
        >
            <Info
                className={`${iconSize} text-muted-foreground/50 hover:text-muted-foreground cursor-help transition-colors shrink-0`}
                aria-label="Info"
            />
            {open && coords && createPortal(
                <div
                    ref={tooltipRef}
                    role="tooltip"
                    className="fixed z-[9999] w-64 px-3 py-2 rounded-lg text-xs leading-relaxed text-foreground bg-card border border-border shadow-lg pointer-events-none"
                    style={{
                        top: coords.top,
                        left: coords.left,
                        transform: getTransform(),
                    }}
                >
                    {text}
                </div>,
                document.body
            )}
        </span>
    );
}
