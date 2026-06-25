package com.digitaldemon.core.kpiformula;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * Configuration for the n8n AI formula generation webhook.
 *
 * Properties are bound from:
 *   kpi-formula.n8n.webhook-url
 *   kpi-formula.n8n.webhook-token
 *   kpi-formula.n8n.timeout-seconds
 */
@Data
@Component
@ConfigurationProperties(prefix = "kpi-formula.n8n")
public class KpiFormulaAiProperties {

    /** Full URL of the n8n webhook that handles KPI formula generation. Empty means feature is disabled. */
    private String webhookUrl = "";

    /**
     * Optional bearer token sent as {@code Authorization: Bearer <token>} when calling the webhook.
     * Must match the Header Auth credential configured on the n8n Webhook node.
     * Leave empty to call the webhook without authentication.
     */
    private String webhookToken = "";

    /** HTTP request timeout in seconds for calls to the n8n webhook. */
    private int timeoutSeconds = 60;
}
