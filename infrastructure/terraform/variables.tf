variable "project_id" {
  description = "GCP project the platform is deployed into (must exist, billing enabled)"
  type        = string
}

variable "region" {
  description = "Region for cluster, registry and network"
  type        = string
  default     = "europe-west3" # Frankfurt
}

variable "cluster_name" {
  description = "Name of the GKE Autopilot cluster"
  type        = string
  default     = "heating-platform"
}

variable "registry_id" {
  description = "Artifact Registry repository id for the service images"
  type        = string
  default     = "heating-platform"
}
