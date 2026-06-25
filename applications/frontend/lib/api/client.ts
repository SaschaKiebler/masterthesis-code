/**
 * API Client Configuration
 * Centralized configuration for API calls
 * Includes Auth0 access token injection for authenticated requests
 */

import { getAccessToken } from "@auth0/nextjs-auth0/client";

const API_BASE_URL = "/api/v1";

/**
 * Custom error class for API errors
 */
export class ApiError extends Error {
    constructor(
        message: string,
        public status: number,
        public statusText: string,
        public data?: any
    ) {
        super(message);
        this.name = "ApiError";
    }
}

/**
 * Get the Authorization header with a Bearer token.
 * Returns empty object if no session exists (unauthenticated).
 */
async function getAuthHeaders(): Promise<Record<string, string>> {
    try {
        const token = await getAccessToken();
        return { Authorization: `Bearer ${token}` };
    } catch {
        // No session or token unavailable — proceed without auth header
        return {};
    }
}

/**
 * Generic fetch wrapper with error handling
 */
export async function apiFetch<T>(
    endpoint: string,
    options?: RequestInit
): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;

    try {
        const authHeaders = await getAuthHeaders();

        const response = await fetch(url, {
            ...options,
            headers: {
                "Content-Type": "application/json",
                ...authHeaders,
                ...options?.headers,
            },
        });

        if (!response.ok) {
            // Redirect to login on 401
            if (response.status === 401) {
                window.location.href = "/auth/login";
                throw new ApiError("Unauthorized", 401, "Unauthorized");
            }

            const errorData = await response.json().catch(() => ({}));
            throw new ApiError(
                errorData.message || `API request failed: ${response.statusText}`,
                response.status,
                response.statusText,
                errorData
            );
        }

        if (response.status === 204 || response.headers.get("content-length") === "0") {
            return undefined as T;
        }

        return response.json();
    } catch (error) {
        if (error instanceof ApiError) {
            throw error;
        }

        // Network or other errors
        throw new ApiError(
            error instanceof Error ? error.message : "Unknown error occurred",
            0,
            "Network Error"
        );
    }
}

/**
 * Build query string from params object
 */
export function buildQueryString(params: Record<string, any>): string {
    const searchParams = new URLSearchParams();

    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
            searchParams.append(key, String(value));
        }
    });

    const queryString = searchParams.toString();
    return queryString ? `?${queryString}` : "";
}
