import { useState, useCallback } from "react";
import { converseDashboardAi } from "@/lib/api/dashboard-ai";
import type { DashboardLayout } from "@/lib/api/types";

export interface ChatMessage {
    id: string;
    role: "user" | "assistant";
    content: string;
    generatedLayout?: DashboardLayout;
}

export function useDashboardAiChat(projectId: string) {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const send = useCallback(async (text: string) => {
        const userMsg: ChatMessage = {
            id: crypto.randomUUID(),
            role: "user",
            content: text,
        };
        setMessages(prev => [...prev, userMsg]);
        setLoading(true);
        setError(null);

        try {
            // Build conversation history for API — only role+content, no generatedLayout
            const apiMessages = [...messages, userMsg].map(m => ({
                role: m.role as "user" | "assistant",
                content: m.content,
            }));

            const response = await converseDashboardAi(projectId, apiMessages);

            const assistantMsg: ChatMessage = {
                id: crypto.randomUUID(),
                role: "assistant",
                content: response.type === "question" ? response.message : response.summary,
                generatedLayout: response.type === "dashboard" ? response.layout : undefined,
            };

            setMessages(prev => [...prev, assistantMsg]);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Something went wrong");
        } finally {
            setLoading(false);
        }
    }, [projectId, messages]);

    const reset = useCallback(() => {
        setMessages([]);
        setError(null);
    }, []);

    return { messages, loading, error, send, reset };
}
