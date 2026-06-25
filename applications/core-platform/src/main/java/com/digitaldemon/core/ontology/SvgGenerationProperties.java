package com.digitaldemon.core.ontology;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * Configuration for the n8n SVG icon generation webhook.
 *
 * Properties are bound from:
 *   svg-generation.n8n.webhook-url
 *   svg-generation.n8n.webhook-token
 *   svg-generation.n8n.timeout-seconds
 */
@Data
@Component
@ConfigurationProperties(prefix = "svg-generation.n8n")
public class SvgGenerationProperties {

    /** Full URL of the n8n webhook that generates P&ID-style SVG icons. Empty means feature is disabled. */
    private String webhookUrl = "";

    /** Optional bearer token for webhook authentication. */
    private String webhookToken = "";

    /** HTTP request timeout in seconds. */
    private int timeoutSeconds = 120;
}
