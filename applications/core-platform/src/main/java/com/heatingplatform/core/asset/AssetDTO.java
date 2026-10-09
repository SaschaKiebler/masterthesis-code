package com.heatingplatform.core.asset;

import java.util.UUID;

public record AssetDTO(
    UUID id,
    UUID siteId,
    UUID spaceId,
    String name,
    String specs
) {}
