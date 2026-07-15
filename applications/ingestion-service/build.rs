fn main() {
    // Proto files are resolved relative to the package directory (CARGO_MANIFEST_DIR).
    // Repository layout: applications/ingestion-service/ → ../../apis/proto/
    // google/protobuf/timestamp.proto is vendored at apis/proto/google/protobuf/timestamp.proto
    // so no system protobuf installation is required.
    prost_build::compile_protos(
        &[
            "../../apis/proto/core/v1/measurement_ingestion.proto",
            "../../apis/proto/device/v1/device_config.proto",
        ],
        &["../../apis/proto"],
    )
    .expect("Failed to compile proto contracts");
}
