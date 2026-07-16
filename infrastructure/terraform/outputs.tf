output "cluster_name" {
  value = google_container_cluster.cluster.name
}

output "region" {
  value = var.region
}

output "registry_url" {
  description = "Prefix for image tags (docker tag <img> <registry_url>/<img>)"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.registry.repository_id}"
}

output "get_credentials_command" {
  value = "gcloud container clusters get-credentials ${google_container_cluster.cluster.name} --region ${var.region} --project ${var.project_id}"
}
