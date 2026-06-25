package com.digitaldemon.core.space;

import java.util.List;
import java.util.UUID;

public record SpaceDTO(
    UUID id,
    UUID siteId,
    UUID parentSpaceId,
    String type,
    String name,
    String attributes,
    List<SpaceDTO> children
) {}
