import { apiFetch } from "./client";
import type { DashboardLayout } from "./types";

export interface ConversationMessage {
    role: "user" | "assistant";
    content: string;
}

export interface AiQuestionResponse {
    type: "question";
    message: string;
}

export interface AiDashboardResponse {
    type: "dashboard";
    layout: DashboardLayout;
    summary: string;
}

export type AiConversationResponse = AiQuestionResponse | AiDashboardResponse;

export async function converseDashboardAi(
    projectId: string,
    messages: ConversationMessage[]
): Promise<AiConversationResponse> {
    return apiFetch<AiConversationResponse>(
        `/projects/${projectId}/dashboard-ai/converse`,
        { method: "POST", body: JSON.stringify({ messages }) }
    );
}
