package com.digitaldemon.core.site;

import java.util.UUID;

public record SiteDTO(
    UUID id,
    String name,
    String address,  // JSONB as raw JSON string
    int assetCount
) {}
