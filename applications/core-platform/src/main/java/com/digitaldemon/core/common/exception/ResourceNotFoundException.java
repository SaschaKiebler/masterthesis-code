package com.digitaldemon.core.common.exception;

import java.util.UUID;

public class ResourceNotFoundException extends ServiceException {
    public ResourceNotFoundException(String resource, UUID id) {
        super(String.format("%s not found: %s", resource, id));
    }

    public ResourceNotFoundException(String message) {
        super(message);
    }
}
