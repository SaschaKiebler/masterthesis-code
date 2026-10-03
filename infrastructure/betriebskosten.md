# Betriebskosten der Evaluationsumgebung

Rechnung hinter Anhang A.7 der Arbeit (Kostenangaben in Kapitel 6, Messumgebung
und Trade-off Datenmenge, sowie in Kapitel 7). Stand 01.10.2026, Listenpreise
ohne Rabatt, Region `europe-west3` (Frankfurt), 730 Stunden je Monat, alle
Beträge in EUR. Es handelt sich um eine Rechnung aus Preislisten, nicht um
eine Messung.

## 1 Quellen

| Quelle | Abgerufen | Verwendung |
|---|---|---|
| Google Cloud SKUs, Währung EUR, Region europe-west3, <https://cloud.google.com/skus?currency=EUR> | 01.10.2026 | Autopilot Pod mCPU Requests (SKU F3C6-E37E-910A), Autopilot Pod Memory Requests (1A3D-44C0-A520), Autopilot Pod Ephemeral Storage Requests (CCE3-AAD8-6D76), Regional Kubernetes Clusters, Cloud Load Balancer Forwarding Rule Minimum Frankfurt (C68C-D380-ED83), Balanced PD Capacity Frankfurt, Cloud SQL for PostgreSQL Zonal vCPU, RAM, SSD und Small Instance Frankfurt |
| Google USD-Preisseiten (`/kubernetes-engine/pricing`, `/compute/disks-image-pricing`, `/vpc/network-pricing`, `/sql/pricing`, `/nat/pricing`) | 01.10.2026 | Kleinposten ohne eigenen EUR-Lookup (Egress, Cloud NAT, LB-Datenverarbeitung, Backups, Artifact Registry), umgerechnet mit 0,8582, dem impliziten Faktor der übrigen Google-EUR-SKUs. Autopilot-SKUs haben einen eigenen Faktor von rund 0,909 |
| Tiger Cloud Pricing, <https://www.tigerdata.com/pricing>, eingebettete Regionstabelle `eu-central-1`, Plan Performance | 01.10.2026 | Verwalteter TimescaleDB-Dienst, Abrechnung nur in USD |
| EZB-Referenzkurs USD, <https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/eurofxref-graph-usd.en.html> | 01.10.2026 | Kurs vom 30.09.2026, 1 EUR = 1,1355 USD (Faktor 0,8807) |

## 2 Grundlage

- GKE Autopilot, regional, Release Channel REGULAR (`terraform/main.tf`).
  Abgerechnet werden die Pod-Requests, sekundengenau, nicht die Knoten.
- Grundlast aus QS-PER-01, 100 Geräte, 500 Messwerte/s. Im Lauf vom
  02.09.2026 blieb die HPA bei 2 Ingestion-Replikas (HPA-Auslastung zuletzt
  71 %, Maximum 76 %, Ziel 70 %), `measurement-db` zog rund 500 Millicores
  von 4 angeforderten vCPU.
- Requests aus `kubernetes/base`, kein Manifest setzt `ephemeral-storage`,
  Autopilot rechnet dafür 1 GiB je Pod.

| Pod | Replikas | vCPU | Arbeitsspeicher |
|---|---|---|---|
| measurement-db | 1 | 4 | 4 GiB |
| core-platform | 1 | 0,5 | 1 GiB |
| kafka | 1 | 0,5 | 1 GiB |
| ingestion-service | 2 | je 0,25 | je 256 MiB |
| analytics-service, device-management, frontend, notification-service, stammdaten-db | je 1 | je 0,25 | je 512 MiB |
| mosquitto | 1 | 0,1 | 128 MiB |
| **Summe** | **11** | **6,85** | **9,125 GiB** |

## 3 Preise (EUR)

| Posten | Preis |
|---|---|
| Autopilot vCPU | 0,04917486 €/vCPU-h |
| Autopilot Arbeitsspeicher | 0,00544279 €/GiB-h |
| Autopilot flüchtiger Speicher | 0,000060589 €/GiB-h |
| Cluster-Gebühr (Regional Kubernetes Clusters) | 0,08582 €/h, 62,65 €/Monat. Die Free-Tier-Gutschrift deckt einen Autopilot- oder Zonal-Cluster je Abrechnungskonto |
| Forwarding Rule Minimum, Frankfurt | 0,025746 €/h, 18,79 €/Monat je Rule (erste 5), danach 0,0102984 €/h |
| LB-Datenverarbeitung | rund 0,0069 €/GiB (0,008 $) |
| pd-balanced (`standard-rwo`), Frankfurt | 0,102984 €/GiB-Monat |
| Internet-Egress Premium (GCP nach AWS) | rund 0,103 €/GiB (0,12 $) |
| Cloud NAT | rund 0,0012 €/VM-h, statische IP rund 0,0043 €/h, rund 0,0386 €/GiB |
| Cloud SQL PostgreSQL Enterprise, Zonal, Frankfurt | vCPU 0,04256672 €/h (31,07 €/Monat), RAM 0,00720888 €/GiB-h (5,26 €/GiB-Monat), SSD 0,1750728 €/GiB-Monat, db-g1-small 0,0360444 €/h (26,31 €/Monat), Backup rund 0,082 €/GiB-Monat, HA verdoppelt den Rechenanteil |
| Artifact Registry | rund 0,086 €/GB-Monat, erste 0,5 GB frei |
| Tiger Cloud `eu-central-1`, Plan Performance, TimescaleDB-Dienst | 0,5 CPU/2 GB 0,0653 $/h, 1 CPU/4 GB 0,3067 $/h, 2 CPU/8 GB 0,6133 $/h, 4 CPU/16 GB 1,2267 $/h, 8 CPU/32 GB 2,4533 $/h |
| Tiger Cloud Speicher (Performance) | rund 0,156 €/GB-Monat auf den komprimierten Verbrauch, Backups und Netzwerk inklusive |
| Compute Flexible CUD | 1 Jahr minus 28 %, 3 Jahre minus 46 % auf vCPU und Arbeitsspeicher |

Tiger Cloud läuft auf AWS (`eu-central-1` Frankfurt) und Azure
(`germanywestcentral` Frankfurt), nicht auf der Google Cloud. Cloud SQL und
AlloyDB bieten die Timescale-Erweiterung nicht an.

## 4 Variante A, alles im Cluster (Ist-Zustand)

| Posten | €/Monat |
|---|---|
| Pods gesamt (vCPU 245,90, Arbeitsspeicher 36,26, flüchtiger Speicher 0,49) | 282,64 |
| davon measurement-db, 4 vCPU, 4 GiB | 159,53 (56 %) |
| davon core-platform und kafka, je 0,5 vCPU, 1 GiB | je 21,97 |
| davon ingestion-service, 2 Replikas | 20,02 |
| davon analytics, device-management, frontend, notification, stammdaten-db, je 0,25 vCPU, 512 MiB | je 11,01 |
| davon mosquitto, 0,1 vCPU, 128 MiB | 4,13 |
| Cluster-Gebühr | 62,65, durch Gutschrift 0 |
| LoadBalancer frontend, eine Forwarding Rule plus rund 130 GiB Datenverarbeitung | 18,79 + 0,90 |
| PVCs, 20 GiB pd-balanced im Startzustand | 2,06 |
| Artifact Registry, rund 2 GB Images | 0,17 |
| **Summe bei Grundlast** | **305** (367 ohne Gutschrift) |

Weitere Fakten zu Variante A.

- measurement-db nach Request, 0,5 vCPU/1 GiB rund 22 €, 2 vCPU/2 GiB rund
  80 €, 4 vCPU/4 GiB rund 160 €.
- HPA auf 3 Replikas plus rund 10 €, HPA am Maximum (10 Replikas, 8,85 vCPU,
  11,125 GiB) Pods 363 statt 283.
- Messsitzung wie `scripts/eval-up.sh` mit vier zusätzlichen internen
  LoadBalancern (5 Forwarding Rules) rund 380 (442 ohne Gutschrift).
- Lastgenerator `mock-load` als Cloud-Run-Job (2 vCPU, 2 GiB) im Dauerbetrieb
  rund 105 zusätzlich, nicht Teil der Plattform.
- Je Standort der Flotte (25 Standorte) 305 / 25 = 12,20 €, je Gerät rund 3 €.

## 5 Variante B, Messwertspeicher in Tiger Cloud

- Cluster ohne measurement-db, 2,85 vCPU, 5,125 GiB, 10 Pods, Pods 123,11,
  PVCs 10 GiB 1,03.
- Egress GKE nach AWS, Annahme 250 Byte je Messwert (Einzel-INSERT mit
  Commit, Protokoll- und TCP-Overhead), rund 300 GiB je Monat, rund 31 €.
- Cloud NAT für eine feste Quelladresse gegenüber der Zugriffsliste von Tiger
  (6 Knoten, 1 statische IP, Datenverarbeitung) rund 20 €, optional.
- Tiger-Speicher bei 190 GiB Rohdaten je Monat und zehnfacher Kompression
  rund 3 € je Monat Daten.

| Tiger-Größe | Tiger Compute | Summe B ohne NAT | mit Cloud NAT |
|---|---|---|---|
| 0,5 CPU / 2 GB (Minimum, keine Reserve) | 41,98 | 220 | 240 |
| 1 CPU / 4 GB (Grundlast, gemessene 0,5 vCPU mit Reserve) | 197,17 | 375 | 395 |
| 2 CPU / 8 GB | 394,28 | 572 | 592 |
| 4 CPU / 16 GB (wie Messlauf, Spitze QS-PER-02) | 788,63 | 967 | 987 |

Summe B = Pods 123,11 + PVC 1,03 + LB 19,68 + Artifact Registry 0,17 +
Tiger Compute + Speicher rund 3 + Egress rund 31. Plan Scale plus 20 % auf
Compute, HA-Replika verdoppelt Compute.

## 6 Variante C, zusätzlich Stammdatenspeicher verwaltet

- Cluster ohne beide Speicher, 2,6 vCPU, 4,625 GiB, 9 Pods, Pods 112,11,
  PVC 5 GiB 0,51.
- Cloud SQL in `europe-west3` liegt im selben Netz (Private IP), kein Egress.

| Stammdatenspeicher | €/Monat |
|---|---|
| Cloud SQL db-g1-small (shared Core, 1,7 GiB) + 10 GiB SSD + Backup | 28,15 |
| Cloud SQL 1 vCPU / 3,75 GiB + 10 GiB SSD + Backup | 52,64 |
| dito mit HA (regional) | rund 105 |
| Tiger Cloud Plain-Postgres 0,5 CPU / 2 GB | 25,10, dann cross-cloud |

| Kombination mit db-g1-small | ohne NAT | mit Cloud NAT |
|---|---|---|
| Tiger 0,5 CPU | 237 | 257 |
| Tiger 1 CPU | 392 | 412 |
| Tiger 4 CPU | 983 | 1.003 |

## 7 Vergleich (€/Monat, wie Tabelle A.7 der Arbeit)

| Variante | Grundlast (1 CPU) | wie Messlauf (4 CPU) | Minimum (0,5 CPU) |
|---|---|---|---|
| A, beide Speicher im Cluster | 305 | 305 | 305 |
| B, Messwertspeicher in Tiger Cloud | 375 bis 395 | 967 bis 987 | 220 bis 240 |
| C, zudem Stammdaten in Cloud SQL | 392 bis 412 | 983 bis 1.003 | 237 bis 257 |

Die Spannen entstehen durch das optionale Cloud NAT.

## 8 Datenwachstum (nicht im Startzustand enthalten)

- Zeilengröße `measurements` rund 155 Byte, aus dem Schema abgeschätzt, nicht
  gemessen (Heap rund 84 Byte, Index `device_id, metric_id, time` rund
  49 Byte, Zeitindex des Hypertables rund 22 Byte, Geräte-IDs mit 17 bis
  18 Zeichen).
- 500 Zeilen/s = 43,2 Mio. Zeilen je Tag, rund 6,2 GiB je Tag, rund 190 GiB
  je Monat unkomprimiert.
- Die 10-GiB-PVC von measurement-db ist nach rund 1,6 Tagen voll.
- Unkomprimiert rund 19,60 € je Monat je Monat Daten, nach 12 Monaten rund
  235 € je Monat. Mit zehnfacher Kompression rund 2 € je Monat je Monat
  Daten. Eine Compression- und Retention-Policy ist im core-platform-Schema
  für `events` vorhanden, für `measurements` nicht.

## 9 Rechenweg

```python
H = 730
CPU = 0.04917486; MEM = 0.00544279; EPH = 0.000060589      # Autopilot EUR-SKUs europe-west3
FEE = 0.08582; LBRULE = 0.025746; PD = 0.102984
SQL_VCPU = 0.04256672; SQL_RAM = 0.00720888; SQL_SSD = 0.1750728; SQL_SMALL = 0.0360444
G = 0.8582            # Google USD -> EUR fuer Kleinposten
ECB = 1 / 1.1355      # Tiger Cloud USD -> EUR, EZB 30.09.2026

pods = {'analytics': (1, .25, .5), 'core': (1, .5, 1), 'device': (1, .25, .5),
        'frontend': (1, .25, .5), 'ingestion': (2, .25, .25), 'kafka': (1, .5, 1),
        'measurement-db': (1, 4, 4), 'mosquitto': (1, .1, .125),
        'notification': (1, .25, .5), 'stammdaten-db': (1, .25, .5)}

def pc(p):
    c = sum(r * cpu for r, cpu, m in p.values())
    m = sum(r * mem for r, cpu, mem in p.values())
    n = sum(r for r, _, _ in p.values())
    return (c * CPU + m * MEM + n * EPH) * H

lb = LBRULE * H + 130 * 0.008 * G
ar = 0.2 * G
A = pc(pods) + lb + 20 * PD + ar                                   # 304,6

tiger = {'0.5/2': 0.0653, '1/4': 0.3067, '2/8': 0.6133, '4/16': 1.2267}   # USD/h
egress = 302 * 0.12 * G
nat = (6 * 0.0014 * H + 0.005 * H + 302 * 0.045) * G
stor = 190 / 5 * 0.177 / 2 * ECB
B = lambda k: (pc({x: v for x, v in pods.items() if x != 'measurement-db'})
               + lb + 10 * PD + ar + tiger[k] * H * ECB + stor + egress)

g1 = SQL_SMALL * H + 10 * SQL_SSD + 0.096 * G                        # 28,15
c1 = SQL_VCPU * H + 3.75 * SQL_RAM * H + 10 * SQL_SSD + 0.096 * G    # 52,64
C = lambda k, db: (pc({x: v for x, v in pods.items() if x not in ('measurement-db', 'stammdaten-db')})
                   + lb + 5 * PD + ar + tiger[k] * H * ECB + stor + egress + db)

for k in ('0.5/2', '1/4', '4/16'):
    print(k, round(B(k)), round(B(k) + nat), round(C(k, g1)), round(C(k, g1) + nat))
```
