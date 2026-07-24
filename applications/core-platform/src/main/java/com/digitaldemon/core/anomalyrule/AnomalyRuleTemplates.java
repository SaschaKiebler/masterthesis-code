package com.digitaldemon.core.anomalyrule;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * The detector template registry — the single source for the UI (served via
 * GET /api/v1/anomaly-rule-templates) and for create/update validation.
 *
 * A template declares which roles a rule must bind and which numeric
 * parameters it accepts. The implementations live in the analytics service
 * (detection/engine.py); the two lists must stay in sync — deliberately,
 * since a template encodes validated domain knowledge and adding one is a
 * curated code change on both sides.
 *
 * Every template additionally accepts the optional {@code suppress_while}
 * binding (a bool channel that pauses evaluation while active).
 */
public final class AnomalyRuleTemplates {

    public record RoleSpec(String role, boolean required, String label) {}

    public record ParamSpec(String key, double defaultValue, String label) {}

    public record TemplateDescriptor(String key, String label, String description,
                                     List<RoleSpec> roles, List<ParamSpec> params,
                                     boolean dynamicRoles) {}

    /** Optional binding accepted by every template. */
    public static final String SUPPRESS_ROLE = "suppress_while";

    public static final List<TemplateDescriptor> ALL = List.of(
            new TemplateDescriptor(
                    "short_cycle",
                    "Short cycling",
                    "Switch-on edges per hour exceed the weather-compensated expectation "
                            + "allowed = base + per_degree * max(0, 15 - t_out).",
                    List.of(new RoleSpec("switch", true, "Burner / pump switch signal")),
                    List.of(new ParamSpec("base_per_hour", 6.0, "Allowed starts/h at mild weather"),
                            new ParamSpec("per_degree", 0.8, "Extra starts/h per degree below 15 °C"),
                            new ParamSpec("window_minutes", 60.0, "Evaluation window (minutes)")),
                    false),
            new TemplateDescriptor(
                    "weather_heating",
                    "Heating despite warm weather",
                    "Sustained heating although the outdoor temperature is above the warm threshold.",
                    List.of(new RoleSpec("switch", true, "Burner / pump switch signal"),
                            new RoleSpec("flow", false, "Flow temperature (optional)")),
                    List.of(new ParamSpec("t_warm_c", 20.0, "Warm-weather threshold (°C outdoor)"),
                            new ParamSpec("min_duty", 0.5, "Duty cycle counting as heating"),
                            new ParamSpec("min_flow_c", 45.0, "Mean flow temperature counting as heating")),
                    false),
            new TemplateDescriptor(
                    "actuator_without_demand",
                    "Actuator runs without demand",
                    "The actuator keeps running although the demand signal has been off "
                            + "for the whole window (e.g. burner off, distribution pump running).",
                    List.of(new RoleSpec("demand", true, "Demand signal (e.g. burner)"),
                            new RoleSpec("actuator", true, "Actuator signal (e.g. pump)")),
                    List.of(new ParamSpec("window_minutes", 30.0, "Evaluation window (minutes)"),
                            new ParamSpec("max_demand_duty", 0.1, "Demand duty below which demand counts as off"),
                            new ParamSpec("min_actuator_duty", 0.9, "Actuator duty above which it counts as running")),
                    false),
            new TemplateDescriptor(
                    "condition",
                    "Custom condition",
                    "Free condition over windowed channel aggregates; roles are chosen freely "
                            + "and each role is bound to a channel. The condition tree lives in "
                            + "params.condition.",
                    List.of(),
                    List.of(),
                    true));

    private static final Map<String, TemplateDescriptor> BY_KEY = ALL.stream()
            .collect(java.util.stream.Collectors.toUnmodifiableMap(TemplateDescriptor::key, t -> t));

    public static Optional<TemplateDescriptor> byKey(String key) {
        return Optional.ofNullable(BY_KEY.get(key));
    }

    private AnomalyRuleTemplates() {}
}
