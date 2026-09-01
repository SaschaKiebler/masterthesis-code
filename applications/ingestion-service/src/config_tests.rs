use super::*;

// ── Per-instance MQTT client id ────────────────────────────

#[test]
fn pod_name_is_used_as_is() {
    // Pod names already start with the deployment name, so no doubling.
    assert_eq!(
        instance_client_id("ingestion-service", Some("ingestion-service-7d9f8b6c4d-x2k9p")),
        "ingestion-service-7d9f8b6c4d-x2k9p"
    );
}

#[test]
fn foreign_hostname_is_appended_to_the_base() {
    assert_eq!(
        instance_client_id("ingestion-service", Some("worker-node-a")),
        "ingestion-service-worker-node-a"
    );
}

#[test]
fn missing_hostname_yields_distinct_ids() {
    // Two processes on one host must still not collide, or the broker would
    // kick one of them on every connect.
    let first = instance_client_id("ingestion-service", None);
    let second = instance_client_id("ingestion-service", None);

    assert_ne!(first, second);
    assert!(first.starts_with("ingestion-service-"));
}

#[test]
fn blank_hostname_counts_as_missing() {
    let id = instance_client_id("ingestion-service", Some("   "));

    assert!(id.starts_with("ingestion-service-"));
    assert_ne!(id, "ingestion-service-");
}
