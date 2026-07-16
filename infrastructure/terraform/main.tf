# GCP infrastructure for the heating-monitoring platform (thesis evaluation).
#
# Deliberately minimal: one Autopilot cluster (per-pod billing, no node
# management), one Artifact Registry repo, one dedicated VPC. Everything
# stateful (Kafka, TimescaleDB) runs in-cluster via the kustomize manifests
# in ../kubernetes, so `terraform destroy` removes the whole evaluation
# environment.

provider "google" {
  project = var.project_id
  region  = var.region
}

resource "google_project_service" "apis" {
  for_each = toset([
    "compute.googleapis.com",
    "container.googleapis.com",
    "artifactregistry.googleapis.com",
  ])

  service            = each.key
  disable_on_destroy = false
}

resource "google_compute_network" "vpc" {
  name                    = "${var.cluster_name}-vpc"
  auto_create_subnetworks = false

  depends_on = [google_project_service.apis]
}

resource "google_compute_subnetwork" "subnet" {
  name          = "${var.cluster_name}-subnet"
  region        = var.region
  network       = google_compute_network.vpc.id
  ip_cidr_range = "10.10.0.0/20"
}

resource "google_container_cluster" "cluster" {
  name     = var.cluster_name
  location = var.region

  enable_autopilot = true

  network    = google_compute_network.vpc.id
  subnetwork = google_compute_subnetwork.subnet.id

  # Autopilot manages the secondary pod/service ranges itself.
  ip_allocation_policy {}

  release_channel {
    channel = "REGULAR"
  }

  # Evaluation environment: allow terraform destroy without manual unlocking.
  deletion_protection = false

  depends_on = [google_project_service.apis]
}

resource "google_artifact_registry_repository" "registry" {
  repository_id = var.registry_id
  location      = var.region
  format        = "DOCKER"
  description   = "Service images for the heating-monitoring platform"

  depends_on = [google_project_service.apis]
}
