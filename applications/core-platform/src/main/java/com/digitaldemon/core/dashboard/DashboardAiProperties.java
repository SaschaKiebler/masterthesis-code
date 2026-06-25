package com.digitaldemon.core.dashboard;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * Configuration for the n8n AI Dashboard Builder webhook.
 *
 * Properties are bound from:
 *   dashboard-ai.n8n.webhook-url
 *   dashboard-ai.n8n.webhook-token
 *   dashboard-ai.n8n.timeout-seconds
 */
@Data
@Component
@ConfigurationProperties(prefix = "dashboard-ai.n8n")
public class DashboardAiProperties {

    /** Full URL of the n8n webhook that handles AI dashboard generation. Empty means feature is disabled. */
    private String webhookUrl = "";

    /**
     * Optional bearer token sent as {@code Authorization: Bearer <token>} when calling the webhook.
     * Must match the Header Auth credential configured on the n8n Webhook node.
     * Leave empty to call the webhook without authentication.
     */
    private String webhookToken = "";

    /** HTTP request timeout in seconds for calls to the n8n webhook. */
    private int timeoutSeconds = 90;
}
