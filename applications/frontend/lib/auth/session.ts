/**
 * Session constants for local authentication.
 * The backend-issued JWT is stored in an httpOnly cookie and attached
 * to backend requests by the /api/v1 proxy route.
 */

export const SESSION_COOKIE = "dd_session";

/** Matches the backend token TTL (local-auth.token-ttl-hours, default 24h). */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24;
