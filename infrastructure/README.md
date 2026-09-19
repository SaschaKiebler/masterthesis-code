# Infrastructure (GKE evaluation environment)

Infrastructure-as-code for running the platform on Google Cloud for the thesis
evaluation (ch. 6). Terraform provisions the cloud resources, kustomize deploys
the workloads, and two scripts bring a measurement session up and take it down
again.

What is **not** here: the measurement setup itself, meaning scenarios, latency
definitions, fleet arithmetic and how a run is evaluated. That lives in
[evaluation/README.md](../evaluation/README.md). This file covers only the
environment those runs need.

```
infrastructure/
├── terraform/               # GKE Autopilot cluster, Artifact Registry, VPC + subnet
├── cloudbuild.yaml          # one build config, parameterised per service
├── kubernetes/
│   ├── base/                # namespace, secrets, 2 stores, kafka, mosquitto, 6 services
│   ├── overlays/gke/        # pins the deployments to the Artifact Registry images
│   ├── eval/                # per-session entry points, internal and external
│   └── jobs/                # mock-seed (tenanta), mock-seed-tenantb, mock-run
└── scripts/
    ├── eval-up.sh           # cluster, platform, fleets, probe users, generators
    ├── eval-down.sh         # entry points, PVCs, cluster, optionally the registry
    ├── cloudbuild-all.sh    # all eight images on Cloud Build, no local docker
    └── build-push.sh        # local docker fallback, seven images, no locust-load
```

## Deploy runbook

Prerequisites are a GCP project with billing enabled, `gcloud auth login` plus
`gcloud auth application-default login`, terraform ≥ 1.7 and kubectl. Local
docker is only needed for `build-push.sh`, the Cloud Build path does without.

The bring-up is scripted end to end. Step through the manual sequence further
down only when the script fails somewhere and you need to see where.

```bash
# 1. Images. Once per code change, on Cloud Build.
infrastructure/scripts/cloudbuild-all.sh                     # all eight
infrastructure/scripts/cloudbuild-all.sh ingestion-service   # or just one

# 2. Everything else. Cluster, platform, both fleets, the tenant-bound probe
#    users, the internal entry points and the two Cloud Run generator jobs.
#    --smoke appends 60 s of telemetry and checks that rows actually land.
infrastructure/scripts/eval-up.sh --smoke

# 3. The scenarios themselves, see evaluation/README.md
evaluation/scripts/ingest-scenario.sh ramp        # capacity first, 12 min
evaluation/scripts/ingest-scenario.sh qs-per-01
evaluation/scripts/ingest-scenario.sh qs-per-02
evaluation/scripts/query-scenario.sh              # QS-PER-03

# 4. Tear down. Removes both entry-point sets and the PVCs first, then the
#    cluster, then asks GCP what is actually left.
infrastructure/scripts/eval-down.sh          # keeps registry and network
infrastructure/scripts/eval-down.sh --all    # removes those as well
```

### Manual sequence

```bash
# Cloud resources, roughly 10 min, mostly cluster creation
terraform -chdir=infrastructure/terraform init
terraform -chdir=infrastructure/terraform apply -var project_id=<PROJECT_ID>

# Deploy. The gke overlay already carries the registry path, there is nothing
# to substitute.
gcloud container clusters get-credentials heating-platform \
  --region europe-west3 --project <PROJECT_ID>
kubectl apply -k infrastructure/kubernetes/overlays/gke
kubectl -n heating-platform get pods -w
# expected order: the two stores, kafka and mosquitto first, then
# device-management, then ingestion (it blocks on device.configured), then
# core, notification, analytics and frontend

# Seed the measured fleet and the small second tenant
kubectl apply -f infrastructure/kubernetes/jobs/mock-seed.yaml
kubectl -n heating-platform wait --for=condition=complete job/mock-seed --timeout=300s
kubectl apply -f infrastructure/kubernetes/jobs/mock-seed-tenantb.yaml

# Entry points for the generators, VPC-internal
kubectl apply -f infrastructure/kubernetes/eval/internal-access.yaml
kubectl -n heating-platform get svc -l eval=internal -w
```

### Where the load comes from

Load generators run **outside** the cluster, because an in-cluster generator
would compete with the services under test for pod resources. They run
**inside** the project all the same, as Cloud Run jobs with direct VPC egress
that reach mosquitto, core and analytics through the internal LoadBalancers of
`eval/internal-access.yaml`. `eval-up.sh` deploys both jobs, `mock-load` for
telemetry and `locust-load` for the query APIs.

That keeps two things at once. Nothing has to be exposed publicly, and the
operator's uplink stays out of the measurement, which matters because QS-PER-02
asks for roughly 1750 messages/s and a laptop behind a campus NAT may not be
able to produce that at all.

`eval/external-access.yaml` is the fallback for the cases that still need a
public address, for instance opening the web UI by hand or driving a generator
from your own machine. Every LoadBalancer in it is pinned to a single /32 via
`loadBalancerSourceRanges`, which is mandatory rather than optional because
mosquitto runs with `allow_anonymous` and an open MQTT port would accept
foreign publishes and corrupt the measurement. Use `curl -4` when determining
your address, otherwise a dual-stack connection hands you an IPv6 address and
the rule never matches the actual traffic. Delete these services **before** the
cluster goes, see the teardown note below.

## Design notes and trade-offs

- **GKE Autopilot** because billing is per requested pod resources and there is
  no node management. The stack requests about 6.9 vCPU and 9.1 GiB at rest,
  rising to about 8.9 vCPU and 11.1 GiB when ingestion sits at its autoscaler
  ceiling. The measurement store alone accounts for 4 of those CPUs. The
  footprint roughly tripled when the store went from 500m to 4 CPU after the
  ramp of 2026-09-01, and since Autopilot bills what is requested, the running
  cost tripled with it. `eval-down.sh` after each session keeps that near zero.
- **Two stores, not one.** `measurement-db` is TimescaleDB and holds the
  measurements, `stammdaten-db` is plain PostgreSQL and holds the master data.
  Both run in-cluster, TimescaleDB because neither Cloud SQL nor AlloyDB offers
  the timescaledb extension. Schemas are created by the owning service's Flyway
  on first start. Both run with `max_connections = 100`, which is what the
  ingestion connection cap below is derived from.
- **Kafka is a single KRaft broker in-cluster** (StatefulSet plus PVC),
  matching the local compose stack. The evaluation targets the platform
  architecture and not broker HA, so replication factor 1 and
  `KAFKA_AUTO_CREATE_TOPICS_ENABLE=false` mirror local behaviour. Topics are
  provisioned exclusively by their owning service, see
  `docs/architecture/event-catalog.md`.
- **Startup ordering is convergence-based.** Services crash-loop or wait until
  their dependencies exist. Ingestion deliberately blocks until it has replayed
  `device.configured`, so it only becomes ready after device-management's first
  sweep. Two ordering traps are closed in configuration rather than in a start
  script. Core and notification share the master-data database, so whichever
  migrates first decides whether the baseline is set correctly, which
  `baseline-version: 0` settles. And because each service creates its topics
  only once at startup, `spring.kafka.admin.fail-fast` makes a service that
  came up before the broker fail loudly instead of running on without its
  topics.
- **Public surface.** The `frontend` service is a LoadBalancer in `base` and is
  therefore the platform's one public entry point in a default deployment.
  Everything else is ClusterIP until a file from `eval/` adds an entry point
  for the session.
- **Not deployed:** kafka-ui. Use `kubectl port-forward` plus local tooling
  instead. Frontend and analytics-service *are* deployed, and QS-PER-03 drives
  the analytics query API directly.
- **Secrets** ship with evaluation defaults in `base/secrets.yaml`. Override
  the `platform-secrets` secret for anything beyond a throwaway cluster.

## Scaling knobs for the evaluation

- **Fleet size and rate** through `--prefix/--sites/--rooms/--interval` on
  `mock-service run`. The seed must match, prefix included, because the tenant
  id is derived from it. `evaluation/scripts/ingest-scenario.sh` sets these per
  scenario, so there is normally nothing to adjust by hand.
  `jobs/mock-run.yaml` remains for functional in-cluster runs only and is not
  used by any measurement, `eval-up.sh --smoke` runs its own short burst
  instead.
- **Consumer scale-out** with
  `kubectl -n heating-platform scale deploy/core-platform --replicas=2`.
  `measurement.ingested` has 3 partitions, so up to 3 effective consumers per
  group.
- **Ingestion scale-out** with
  `kubectl -n heating-platform scale deploy/ingestion-service --replicas=4`.
  Each pod takes its MQTT client id from its pod name and subscribes through
  the shared-subscription group `ingestion` (`MQTT_SHARE_GROUP`), so mosquitto
  hands each message to exactly one pod instead of delivering it to every
  replica. Setting `MQTT_SHARE_GROUP` to an empty value falls back to plain
  subscriptions for brokers without shared-subscription support, which then
  caps the service at one replica.
- **Ingestion autoscaling.** An HPA scales the deployment on CPU between 2 and
  10 pods at a 70 % target. Watch it with
  `kubectl -n heating-platform get hpa ingestion-service -w`, and pin the
  replica count for a controlled measurement by deleting the HPA first.
- **Connection budget**, `DB_MAX_CONNECTIONS` on ingestion, currently 6. This
  is the one knob that must be re-derived whenever the HPA ceiling or
  `max_connections` changes, see the first sensitivity point below.

## Sensitivity points, measured

These are results of the runs of 2026-09-01 and 2026-09-02, not expectations.
The full picture is in ch. 6 of the thesis, the short version belongs here
because each one is an operational trap.

- **The connection budget is the sharpest of them.** Left unbounded, deadpool
  sizes the ingestion pool from the *node's* CPU count, which has nothing to do
  with what the store can serve. Under the QS-PER-02 spike the autoscaler went
  to nine replicas, the sum of the pools passed the store's
  `max_connections = 100`, and the run lost 5.65 % of its measurements at a p95
  of 224 s while the store itself was only half busy. With a fixed cap of 6 per
  replica, derived from `max_connections` and the HPA ceiling, the same load
  loses nothing at a p95 of 15 ms.
- **The store's CPU is the throughput lever of the whole chain**, because
  ingestion commits once per measurement. At 500m the chain saturates around
  1400 measurements/s, at 2 CPU around 2300, so four times the CPU buys a
  factor of 1.6. It is now at 4 CPU rather than 2 because at 2 the pod drew
  2472 millicores, meaning it burst past its own request and the measurement
  leaned on capacity it was not guaranteed.
- **Mosquitto stays a single pod** and cannot be relieved by allocation or
  replication the way ingestion and the store can. It was not the bottleneck in
  any run, but it structurally bounds both the message rate and the number of
  concurrently connected devices.
- **Shared subscriptions do not preserve per-device order.** Mosquitto
  distributes round-robin without per-key affinity, so consecutive messages of
  one device may be handled by different pods and the arrival order of
  `measurement.ingested` per device is not determined. The per-measurement
  `time` stays authoritative.
- **Ingestion applies no backpressure of its own.** It spawns a task per
  incoming message without a bound. No overflow was observed, but only because
  the broker's queues push back first, which makes the safety a property of
  mosquitto's queue size rather than of the service.

## Teardown, two ways to leak money

Both have actually happened, and `eval-down.sh` handles both. They are recorded
here because a manual teardown will hit them again.

- **Forwarding rules can outlive the cluster.** Delete the LoadBalancer
  services from `eval/` first, give GCP a moment, then destroy. `eval-down.sh`
  checks afterwards and prints anything that survived.
- **Persistent disks are not deleted with the cluster.** The PVCs vanish along
  with it before the CSI driver can reclaim the disks, leaving roughly 30 GB of
  orphaned pd-balanced behind per session. Fourteen of those once filled the
  regional SSD quota and made a later bring-up fail on volumes that would not
  bind. Delete the statefulsets and PVCs while the cluster is still up.
