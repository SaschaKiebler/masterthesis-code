package com.digitaldemon.notification;

import java.util.Map;

/** Shared severity ranking for policy and rule matching. */
public final class Severity {

    private static final Map<String, Integer> RANK = Map.of(
            "INFO", 0,
            "WARNING", 1,
            "ERROR", 2,
            "CRITICAL", 3);

    private Severity() {
    }

    public static int rank(String severity) {
        return RANK.getOrDefault(severity == null ? "" : severity.toUpperCase(), 0);
    }

    public static boolean atLeast(String severity, String minimum) {
        return rank(severity) >= rank(minimum);
    }
}
