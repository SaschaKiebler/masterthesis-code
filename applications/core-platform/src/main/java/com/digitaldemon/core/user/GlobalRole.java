package com.digitaldemon.core.user;

public enum GlobalRole {
    SYSTEM_ADMIN("system_admin"),
    CONSULTANT("consultant"),
    LANDLORD("landlord"),
    TECHNICIAN("technician"),
    RESIDENT("resident"),
    VIEWER("viewer");

    private final String value;

    GlobalRole(String value) {
        this.value = value;
    }

    public String getValue() {
        return value;
    }

    public static GlobalRole fromValue(String value) {
        for (GlobalRole role : values()) {
            if (role.value.equalsIgnoreCase(value)) {
                return role;
            }
        }
        return VIEWER;
    }
}
