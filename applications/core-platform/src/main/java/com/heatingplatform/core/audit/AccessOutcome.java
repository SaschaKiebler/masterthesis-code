package com.heatingplatform.core.audit;

/**
 * How the platform answered an access attempt that was not the caller's own
 * tenant. The distinction is what QS-SEC-01 measures.
 */
public enum AccessOutcome {

    /** The application refused outright, 403. */
    DENIED,

    /**
     * The request named a foreign tenant and still got a 2xx, because the
     * endpoint filters foreign rows away rather than refusing. No data leaves,
     * but nothing signals the attempt either — the gap this audit trail closes.
     */
    FILTERED,

    /** No valid credentials, 401. */
    UNAUTHENTICATED
}
