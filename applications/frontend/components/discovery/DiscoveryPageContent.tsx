/**
 * DiscoveryPageContent — Main discovery page component.
 * Device ID input → Start/Stop → Live message feed → Analyze → Create Template.
 */

"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { MessageFeed } from "@/components/discovery/MessageFeed";
import { PayloadStructure } from "@/components/discovery/PayloadStructure";
import { DiscoveryToTemplateModal } from "@/components/discovery/DiscoveryToTemplateModal";
import { startDiscovery, getDiscoverySession, stopDiscovery, analyzeDiscovery } from "@/lib/api/discovery";
import { listObjectTypes } from "@/lib/api/registry";
import type { DiscoverySession, CapturedMessage, PayloadAnalysis, ObjectType } from "@/lib/api/types";
import { Radio, Square, Play, Search, Sparkles } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";

export function DiscoveryPageContent() {
    const { activeTenant } = useAuth();

    // Input
    const [deviceId, setDeviceId] = useState("");

    // Session state
    const [session, setSession] = useState<DiscoverySession | null>(null);
    const [messages, setMessages] = useState<CapturedMessage[]>([]);
    const [isStarting, setIsStarting] = useState(false);
    const [isStopping, setIsStopping] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Analysis state
    const [analysis, setAnalysis] = useState<PayloadAnalysis | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);

    // Template modal state
    const [showTemplateModal, setShowTemplateModal] = useState(false);
    const [objectTypes, setObjectTypes] = useState<ObjectType[]>([]);

    // Polling ref
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const lastTimestampRef = useRef<number>(0);

    const isListening = session?.status === "LISTENING";

    // Start polling when session is LISTENING
    useEffect(() => {
        if (isListening && session) {
            pollRef.current = setInterval(async () => {
                try {
                    const updated = await getDiscoverySession(
                        session.sessionId,
                        lastTimestampRef.current || undefined
                    );

                    if (updated.messages.length > 0) {
                        setMessages((prev) => {
                            const newMsgs = [...prev, ...updated.messages];
                            lastTimestampRef.current = updated.messages[updated.messages.length - 1].timestamp;
                            return newMsgs;
                        });
                    }

                    // Update session status (may have timed out)
                    if (updated.status !== "LISTENING") {
                        setSession(updated);
                    }
                } catch {
                    // Polling errors are non-fatal
                }
            }, 2000);

            return () => {
                if (pollRef.current) clearInterval(pollRef.current);
            };
        }
    }, [isListening, session?.sessionId]);

    // Stop polling when session stops
    useEffect(() => {
        if (!isListening && pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
    }, [isListening]);

    const handleStart = useCallback(async () => {
        if (!deviceId.trim()) return;
        setError(null);
        setIsStarting(true);
        setMessages([]);
        setAnalysis(null);
        lastTimestampRef.current = 0;

        try {
            const newSession = await startDiscovery({
                deviceId: deviceId.trim(),
                tenantId: activeTenant?.id,
            });
            setSession(newSession);
            if (newSession.messages.length > 0) {
                setMessages(newSession.messages);
            }
        } catch (err: any) {
            setError(err?.message || "Failed to start discovery session");
        } finally {
            setIsStarting(false);
        }
    }, [deviceId]);

    const handleStop = useCallback(async () => {
        if (!session) return;
        setIsStopping(true);

        try {
            const stopped = await stopDiscovery(session.sessionId);
            setSession(stopped);
            // Merge any final messages
            if (stopped.messages.length > 0) {
                setMessages((prev) => [...prev, ...stopped.messages]);
            }
        } catch (err: any) {
            setError(err?.message || "Failed to stop session");
        } finally {
            setIsStopping(false);
        }
    }, [session]);

    const handleAnalyze = useCallback(async () => {
        if (!session) return;
        setIsAnalyzing(true);
        setError(null);

        try {
            const result = await analyzeDiscovery(session.sessionId);
            setAnalysis(result);
        } catch (err: any) {
            setError(err?.message || "Failed to analyze payloads");
        } finally {
            setIsAnalyzing(false);
        }
    }, [session]);

    const handleCreateTemplate = useCallback(async () => {
        try {
            const res = await listObjectTypes();
            setObjectTypes(res.objectTypes);
        } catch {
            // proceed with empty list
        }
        setShowTemplateModal(true);
    }, []);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !isListening) {
            e.preventDefault();
            handleStart();
        }
    };

    const elapsed = session?.startedAt
        ? Math.floor((Date.now() - session.startedAt) / 1000)
        : 0;

    return (
        <div className="min-h-screen bg-background">
            <Header
                title="Device Scanner"
                subtitle="Scan and receive MQTT messages from devices"
                breadcrumbs={[
                    { label: "Dashboard", href: "/" },
                    { label: "Device Scanner" },
                ]}
            />

            <div className="p-4 md:p-8 space-y-6 max-w-4xl">
                {/* Device ID input + Start/Stop */}
                <div className="flex gap-3 items-end">
                    <div className="flex-1">
                        <Input
                            label="Device ID"
                            placeholder='e.g. "shellyplus1pm-a8032abc1234"'
                            value={deviceId}
                            onChange={(e) => setDeviceId(e.target.value)}
                            onKeyDown={handleKeyDown}
                            disabled={isListening}
                        />
                    </div>
                    {isListening ? (
                        <Button
                            type="button"
                            variant="danger"
                            onClick={handleStop}
                            loading={isStopping}
                            disabled={isStopping}
                        >
                            <Square className="h-4 w-4 mr-1" />
                            Stop
                        </Button>
                    ) : (
                        <Button
                            type="button"
                            variant="primary"
                            onClick={handleStart}
                            loading={isStarting}
                            disabled={!deviceId.trim() || isStarting}
                        >
                            <Play className="h-4 w-4 mr-1" />
                            Start Listening
                        </Button>
                    )}
                </div>

                {/* Error */}
                {error && (
                    <div className="p-3 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger" role="alert">
                        {error}
                    </div>
                )}

                {/* Status bar */}
                {session && (
                    <div className="flex items-center gap-3 flex-wrap">
                        <Badge
                            variant={isListening ? "success" : session.status === "TIMED_OUT" ? "warning" : "default"}
                            size="sm"
                        >
                            {isListening && (
                                <Radio className="h-3 w-3 mr-1 animate-pulse" />
                            )}
                            {session.status}
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                            {messages.length} message{messages.length !== 1 ? "s" : ""} captured
                            {session.uniqueTopicCount > 0 && (
                                <> · {session.uniqueTopicCount} unique topic{session.uniqueTopicCount !== 1 ? "s" : ""}</>
                            )}
                        </span>
                        {isListening && (
                            <span className="text-sm text-muted-foreground">
                                · Listening for {elapsed}s
                            </span>
                        )}
                        <span className="text-xs text-muted-foreground font-mono">
                            Device: {session.deviceId}
                        </span>
                    </div>
                )}

                {/* Message feed */}
                {session && (
                    <div>
                        <h3 className="text-sm font-semibold text-foreground mb-2">Captured Messages</h3>
                        <MessageFeed messages={messages} />
                    </div>
                )}

                {/* Action buttons */}
                {session && !isListening && messages.length > 0 && (
                    <div className="flex gap-3">
                        <Button
                            type="button"
                            variant="primary"
                            onClick={handleAnalyze}
                            loading={isAnalyzing}
                            disabled={isAnalyzing}
                        >
                            <Search className="h-4 w-4 mr-1" />
                            {isAnalyzing ? "Analyzing..." : "Analyze Payloads"}
                        </Button>
                        {analysis && (
                            <Button
                                type="button"
                                variant="primary"
                                onClick={handleCreateTemplate}
                            >
                                <Sparkles className="h-4 w-4 mr-1" />
                                Create Template
                            </Button>
                        )}
                    </div>
                )}

                {/* Analysis results */}
                {analysis && (
                    <div>
                        <h3 className="text-sm font-semibold text-foreground mb-2">Payload Analysis</h3>
                        <PayloadStructure analysis={analysis} />
                    </div>
                )}
            </div>

            {/* Template creation modal */}
            {analysis && (
                <DiscoveryToTemplateModal
                    open={showTemplateModal}
                    onClose={() => setShowTemplateModal(false)}
                    onSuccess={() => {
                        setShowTemplateModal(false);
                        setSession(null);
                        setMessages([]);
                        setAnalysis(null);
                        setDeviceId("");
                    }}
                    analysis={analysis}
                    deviceId={session?.deviceId ?? deviceId}
                    objectTypes={objectTypes}
                />
            )}
        </div>
    );
}
