use super::*;

fn config(topic: &str, extra: &[&str], share_group: Option<&str>) -> MqttConfig {
    MqttConfig {
        topic: topic.to_string(),
        extra_topics: extra.iter().map(|t| t.to_string()).collect(),
        share_group: share_group.map(|g| g.to_string()),
        ..Default::default()
    }
}

// ── Filter subsumption ─────────────────────────────────────

#[test]
fn catch_all_covers_everything() {
    assert!(covers("#", "house/+/sensor/#"));
    assert!(covers("#", "tele/#"));
    assert!(covers("#", "a/b/c"));
    assert!(covers("#", "#"));
}

#[test]
fn multi_level_wildcard_covers_its_own_parent_level() {
    // `sport/#` matches `sport` itself (MQTT-4.7.1-2).
    assert!(covers("tele/#", "tele"));
    assert!(covers("tele/#", "tele/dev1/SENSOR"));
}

#[test]
fn single_level_wildcard_does_not_cover_multi_level() {
    assert!(covers("house/+/sensor", "house/kitchen/sensor"));
    assert!(!covers("house/+", "house/#"));
    assert!(!covers("house/+", "house/kitchen/sensor"));
}

#[test]
fn narrower_filter_does_not_cover_broader_one() {
    assert!(!covers("tele/#", "#"));
    assert!(!covers("house/+/sensor/#", "#"));
    assert!(!covers("a/b", "a"));
    assert!(!covers("a", "a/b"));
}

#[test]
fn wildcards_do_not_cover_dollar_topics() {
    // MQTT-4.7.2-1: a leading wildcard never matches `$`-prefixed topics.
    assert!(!covers("#", "$SYS/broker/uptime"));
    assert!(!covers("+/broker/uptime", "$SYS/broker/uptime"));
}

// ── Effective subscription set ─────────────────────────────

#[test]
fn overlapping_filters_are_collapsed_to_the_broadest() {
    // The broker delivers once per matching subscription, so keeping both
    // `house/+/sensor/#` and the catch-all would double every house message.
    let filters = subscription_filters(&config("house/+/sensor/#", &["#"], None));
    assert_eq!(filters, vec!["#"]);
}

#[test]
fn disjoint_filters_are_all_kept() {
    let filters = subscription_filters(&config("house/+/sensor/#", &["tele/#"], None));
    assert_eq!(filters, vec!["house/+/sensor/#", "tele/#"]);
}

#[test]
fn duplicate_filters_are_dropped() {
    let filters = subscription_filters(&config("tele/#", &["tele/#", "tele/#"], None));
    assert_eq!(filters, vec!["tele/#"]);
}

#[test]
fn empty_filters_are_skipped() {
    let filters = subscription_filters(&config("tele/#", &["", "stat/#"], None));
    assert_eq!(filters, vec!["tele/#", "stat/#"]);
}

// ── Shared-subscription wrapping ───────────────────────────

#[test]
fn share_group_wraps_every_filter() {
    let filters = subscription_filters(&config("house/+/sensor/#", &["tele/#"], Some("ingestion")));
    assert_eq!(
        filters,
        vec![
            "$share/ingestion/house/+/sensor/#",
            "$share/ingestion/tele/#",
        ]
    );
}

#[test]
fn share_group_wraps_after_collapsing() {
    // Wrapping first would hide the overlap: two `$share` filters are two
    // independent groups, so the duplicate would land on two different pods.
    let filters = subscription_filters(&config("house/+/sensor/#", &["#"], Some("ingestion")));
    assert_eq!(filters, vec!["$share/ingestion/#"]);
}

#[test]
fn without_share_group_filters_stay_plain() {
    let filters = subscription_filters(&config("tele/#", &[], None));
    assert_eq!(filters, vec!["tele/#"]);
}
