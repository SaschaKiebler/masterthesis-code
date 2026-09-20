# mock-service

Simulierte Geräteflotte für die Heizungsmonitoring-Plattform. Legt Kessel
und Raumsensoren in der Plattform an (`seed`) und sendet deren Telemetrie
per MQTT (`run`), für Funktionstests, Demos und die Lastmessungen der
Evaluation.

Die Dokumentation liegt unter
[docs/applications/mock-service/](../../docs/applications/mock-service/README.md).

```bash
python3 -m venv .venv && .venv/bin/pip install -e .
.venv/bin/mock-service seed --sites 2 --rooms 2
.venv/bin/mock-service run  --sites 2 --rooms 2 --interval 10
```
