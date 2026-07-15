/**
 * API Client Configuration
 * Centralized configuration for API calls
 * Authentication rides on the httpOnly session cookie; the /api/v1 proxy
 * route converts it into a Bearer token for the backend.
 */

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
 * Generic fetch wrapper with error handling
 */
export async function apiFetch<T>(
    endpoint: string,
    options?: RequestInit
): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;

    try {
        const response = await fetch(url, {
            ...options,
            headers: {
                "Content-Type": "application/json",
                ...options?.headers,
            },
        });

        if (!response.ok) {
            // Redirect to login on 401 (unless we're already there)
            if (response.status === 401) {
                if (!window.location.pathname.startsWith("/auth/login")) {
                    window.location.href = "/auth/login";
                }
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
