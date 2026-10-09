package com.heatingplatform.core.user;

public enum TenantRole {
    OWNER("owner", 4),
    MANAGER("manager", 3),
    MEMBER("member", 2),
    VIEWER("viewer", 1);

    private final String value;
    private final int level;

    TenantRole(String value, int level) {
        this.value = value;
        this.level = level;
    }

    public String getValue() {
        return value;
    }

    public int getLevel() {
        return level;
    }

    /**
     * Returns true if this role has at least the given minimum role's privileges.
     */
    public boolean isAtLeast(TenantRole minimum) {
        return this.level >= minimum.level;
    }

    public static TenantRole fromValue(String value) {
        for (TenantRole role : values()) {
            if (role.value.equalsIgnoreCase(value)) {
                return role;
            }
        }
        return VIEWER;
    }
}
