"use client";

/**
 * DashboardAiModal — conversational AI assistant for building dashboard layouts.
 * Users describe what they want to monitor; the AI asks clarifying questions and
 * ultimately returns a ready-to-apply DashboardLayout.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { Sparkles, Send } from "lucide-react";
import { Modal, ModalHeader, ModalContent, ModalFooter } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { useDashboardAiChat } from "@/lib/hooks/useDashboardAiChat";
import type { DashboardLayout, DashboardWidget } from "@/lib/api/types";
import type { ChatMessage } from "@/lib/hooks/useDashboardAiChat";
import { cn } from "@/lib/utils/cn";

// ─── Props ────────────────────────────────────────────────────────────────────

interface DashboardAiModalProps {
    open: boolean;
    onClose: () => void;
    projectId: string;
    onApply: (layout: DashboardLayout) => void;
    hasExistingWidgets: boolean;
}

// ─── Suggestion chips shown beneath the greeting ──────────────────────────────

const SUGGESTIONS = [
    "Energy overview",
    "Device status",
    "Temperature monitoring",
] as const;

// ─── Widget type breakdown helper ─────────────────────────────────────────────

function summariseWidgetTypes(widgets: DashboardWidget[]): string {
    const counts: Record<string, number> = {};
    for (const w of widgets) {
        counts[w.type] = (counts[w.type] ?? 0) + 1;
    }

    const LABELS: Record<string, string> = {
        time_series: "Time Series",
        gauge: "Gauge",
        stat_card: "Stat Card",
        status: "Status",
        derived_property: "Derived Property",
        event_timeline: "Event Timeline",
        event_log: "Event Log",
        comparison: "Comparison",
    };

    return Object.entries(counts)
        .map(([type, count]) => `${count}x ${LABELS[type] ?? type}`)
        .join(", ");
}

// ─── Dashboard preview card ───────────────────────────────────────────────────

interface DashboardPreviewCardProps {
    layout: DashboardLayout;
    summary: string;
}

function DashboardPreviewCard({ layout, summary }: DashboardPreviewCardProps) {
    return (
        <div className="bg-muted/50 border border-border rounded-lg p-3 mt-2">
            <p className="text-xs font-semibold text-foreground mb-1">Dashboard ready</p>
            <ul className="text-xs text-muted-foreground space-y-0.5">
                <li>{layout.widgets.length} widget{layout.widgets.length !== 1 ? "s" : ""}</li>
                <li>{layout.columns} column{layout.columns !== 1 ? "s" : ""}</li>
                {layout.widgets.length > 0 && (
                    <li>{summariseWidgetTypes(layout.widgets)}</li>
                )}
            </ul>
            <p className="text-xs text-muted-foreground mt-2 italic">{summary}</p>
        </div>
    );
}

// ─── Typing indicator ─────────────────────────────────────────────────────────

function TypingIndicator() {
    return (
        <div className="flex justify-start">
            <div className="mr-auto max-w-[80%] bg-muted text-foreground rounded-2xl rounded-bl-md px-4 py-3">
                <span className="flex items-center gap-1">
                    {[0, 1, 2].map((i) => (
                        <span
                            key={i}
                            className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce"
                            style={{ animationDelay: `${i * 150}ms` }}
                        />
                    ))}
                </span>
            </div>
        </div>
    );
}

// ─── Simple markdown renderer for assistant messages ─────────────────────────

function renderMarkdown(text: string): React.ReactNode[] {
    // Split on numbered list items (e.g. "1. ", "2. ") that appear after newlines or at start
    const lines = text.split(/\n/);
    const elements: React.ReactNode[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (i > 0) elements.push(<br key={`br-${i}`} />);

        // Check for numbered list: "1. **text**: rest"
        const listMatch = line.match(/^(\d+)\.\s+(.*)/);
        if (listMatch) {
            elements.push(
                <span key={`li-${i}`} className="flex gap-2 mt-1.5 first:mt-0">
                    <span className="text-muted-foreground shrink-0">{listMatch[1]}.</span>
                    <span>{renderInline(listMatch[2])}</span>
                </span>
            );
        } else {
            elements.push(<span key={`l-${i}`}>{renderInline(line)}</span>);
        }
    }

    return elements;
}

function renderInline(text: string): React.ReactNode[] {
    // Handle **bold** patterns
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, i) => {
        const boldMatch = part.match(/^\*\*(.+)\*\*$/);
        if (boldMatch) {
            return <strong key={i} className="font-semibold">{boldMatch[1]}</strong>;
        }
        return <span key={i}>{part}</span>;
    });
}

// ─── Message bubble ───────────────────────────────────────────────────────────

interface MessageBubbleProps {
    message: ChatMessage;
}

function MessageBubble({ message }: MessageBubbleProps) {
    const isUser = message.role === "user";

    return (
        <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
            <div
                className={cn(
                    "max-w-[80%] px-4 py-2 text-sm",
                    isUser
                        ? "ml-auto bg-primary text-primary-foreground rounded-2xl rounded-br-md"
                        : "mr-auto bg-muted text-foreground rounded-2xl rounded-bl-md"
                )}
            >
                {isUser ? message.content : renderMarkdown(message.content)}
                {message.generatedLayout && (
                    <DashboardPreviewCard
                        layout={message.generatedLayout}
                        summary={message.content}
                    />
                )}
            </div>
        </div>
    );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

export function DashboardAiModal({
    open,
    onClose,
    projectId,
    onApply,
    hasExistingWidgets,
}: DashboardAiModalProps) {
    const chat = useDashboardAiChat(projectId);
    const [inputValue, setInputValue] = useState("");
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [pendingLayout, setPendingLayout] = useState<DashboardLayout | null>(null);
    const bottomRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom whenever messages change or loading state changes
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [chat.messages, chat.loading]);

    // Reset chat state whenever the modal is closed
    useEffect(() => {
        if (!open) {
            chat.reset();
            setInputValue("");
            setConfirmOpen(false);
            setPendingLayout(null);
        }
    // chat.reset is stable via useCallback([]) so this is safe
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // Determine if the last assistant message contains a generated layout
    const lastAssistantMessage = [...chat.messages]
        .reverse()
        .find(m => m.role === "assistant");
    const generatedLayout = lastAssistantMessage?.generatedLayout ?? null;

    const handleSend = useCallback(
        async (text: string) => {
            const trimmed = text.trim();
            if (!trimmed || chat.loading) return;
            setInputValue("");
            await chat.send(trimmed);
        },
        [chat]
    );

    const handleFormSubmit = useCallback(
        (e: React.FormEvent) => {
            e.preventDefault();
            handleSend(inputValue);
        },
        [inputValue, handleSend]
    );

    const handleApply = useCallback(() => {
        if (!generatedLayout) return;

        // Regenerate all widget IDs to avoid collisions with existing widgets
        const freshLayout: DashboardLayout = {
            ...generatedLayout,
            widgets: generatedLayout.widgets.map(w => ({
                ...w,
                id: crypto.randomUUID(),
            })),
        };

        if (hasExistingWidgets) {
            setPendingLayout(freshLayout);
            setConfirmOpen(true);
        } else {
            onApply(freshLayout);
            onClose();
        }
    }, [generatedLayout, hasExistingWidgets, onApply, onClose]);

    const handleConfirmApply = useCallback(() => {
        if (!pendingLayout) return;
        onApply(pendingLayout);
        setConfirmOpen(false);
        onClose();
    }, [pendingLayout, onApply, onClose]);

    const showSuggestions = chat.messages.length === 0;

    return (
        <>
            <Modal open={open} onClose={onClose} className="md:max-w-2xl">
                <ModalHeader onClose={onClose}>
                    <span className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
                        AI Dashboard Assistant
                    </span>
                </ModalHeader>

                {/* Message list */}
                <ModalContent className="flex flex-col flex-1 min-h-[400px] overflow-y-auto gap-3">
                    {/* Greeting */}
                    <div className="flex justify-start">
                        <div className="mr-auto max-w-[80%] bg-muted text-foreground rounded-2xl rounded-bl-md px-4 py-2 text-sm">
                            Hi! I can help you design a dashboard for this project. What would you like to monitor?
                        </div>
                    </div>

                    {/* Suggestion chips — only shown before the first message is sent */}
                    {showSuggestions && (
                        <div className="flex flex-wrap gap-2 ml-1">
                            {SUGGESTIONS.map((suggestion) => (
                                <button
                                    key={suggestion}
                                    type="button"
                                    onClick={() => handleSend(suggestion)}
                                    disabled={chat.loading}
                                    className="px-3 py-1.5 text-xs font-medium rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-primary/50 hover:bg-primary/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {suggestion}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Conversation messages */}
                    {chat.messages.map((message) => (
                        <MessageBubble key={message.id} message={message} />
                    ))}

                    {/* Typing indicator */}
                    {chat.loading && <TypingIndicator />}

                    {/* Error */}
                    {chat.error && (
                        <p className="text-xs text-destructive text-center py-1">
                            {chat.error}
                        </p>
                    )}

                    {/* Scroll anchor */}
                    <div ref={bottomRef} />
                </ModalContent>

                {/* Footer — input row or apply/reset actions */}
                <ModalFooter className="sm:flex-row sm:items-center">
                    {generatedLayout ? (
                        <>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => { chat.reset(); setInputValue(""); }}
                            >
                                Start Over
                            </Button>
                            <Button
                                variant="primary"
                                size="sm"
                                onClick={handleApply}
                            >
                                Apply to Dashboard
                            </Button>
                        </>
                    ) : (
                        <form
                            onSubmit={handleFormSubmit}
                            className="flex items-center gap-2 w-full"
                        >
                            <input
                                type="text"
                                value={inputValue}
                                onChange={(e) => setInputValue(e.target.value)}
                                placeholder="Describe what you'd like to monitor..."
                                disabled={chat.loading}
                                className="flex-1 bg-muted border-0 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
                                aria-label="Message to AI assistant"
                            />
                            <Button
                                type="submit"
                                variant="primary"
                                size="sm"
                                disabled={!inputValue.trim() || chat.loading}
                                aria-label="Send message"
                            >
                                <Send className="h-4 w-4" aria-hidden="true" />
                            </Button>
                        </form>
                    )}
                </ModalFooter>
            </Modal>

            {/* Confirm overwrite existing widgets */}
            <ConfirmModal
                open={confirmOpen}
                onClose={() => setConfirmOpen(false)}
                onConfirm={handleConfirmApply}
                title="Replace Dashboard Layout"
                message="This will replace your current dashboard layout. Continue?"
                confirmLabel="Replace"
            />
        </>
    );
}
