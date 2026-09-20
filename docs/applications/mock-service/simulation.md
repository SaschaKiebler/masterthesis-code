# Simulation

## Geräte und Nachrichten

Zwei Gerätetypen decken die beiden Parser-Routen des ingestion-service ab.

**Kesselregler.** Sendet je Takt ein JSON-Dokument auf `<id>/data`. Es
trägt mit `ts` eine eigene Uhr, so wie ein Gateway es täte. Nur dadurch kann
die Plattform Sendezeit und Empfangszeit auseinanderhalten, was die
Latenzmessung der Evaluation braucht.

```json
{"flow_c":48.3,"return_c":33.9,"power_kw":21.4,"pump":true,"ts":"2026-09-20T10:15:00+00:00"}
```

**Raumsensor Shelly Plus H&T.** Sendet je Takt zwei Nachrichten und alle
zehn Takte eine dritte, im Format der echten Geräte (Gen2). Ohne
Zeitstempel, weil die echten Sensoren auch keinen senden.

| Topic                          | Nutzlast                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `<id>/status/temperature:0`    | `{"id":0,"tC":21.4,"tF":70.5}`                                               |
| `<id>/status/humidity:0`       | `{"id":0,"rh":52.3}`                                                         |
| `<id>/status/devicepower:0`    | `{"id":0,"battery":{"V":2.93,"percent":88},"external":{"present":false}}`    |

## Das Modell

Kein Gebäudephysik-Simulator, nur so viel Struktur, dass die Daten wie eine
echte Heizung aussehen.

- **Wetter je Standort.** Eine Tageskurve um den Mittelwert
  (`mean_outdoor_c`, Standard 8 °C) mit einer Amplitude
  (`diurnal_amplitude_c`, Standard 4 K), Höchstwert am Nachmittag, Tiefstwert
  nachts, dazu ein langsames Rauschen. Alle Geräte eines Standorts sehen
  dasselbe Wetter. Über 15 °C Außentemperatur ist die Heizung aus.
- **Kessel.** Die Vorlauftemperatur folgt einer Heizkurve
  (`30 + 1,3 * (20 - t_out)`, begrenzt auf 30 bis 70 °C) mit zwei Minuten
  Trägheit. Der Rücklauf liegt im Heizbetrieb rund 15 K darunter, mit
  langsamer Schwankung. Die Leistung ergibt sich aus der Spreizung, die Pumpe
  läuft, solange geheizt wird.
- **Raum.** Die Raumtemperatur strebt mit zehn Minuten Trägheit einem
  Sollwert um 21 °C zu, bei Heizung aus einem niedrigeren Wert. Die Feuchte
  ist grob gegenläufig zur Temperatur. Die Batterie entlädt sich über etwa
  180 Tage.

Jedes Gerät hat seinen eigenen Zufallsgenerator aus `--seed` und Geräte-ID,
deshalb sind Läufe mit gleichen Parametern reproduzierbar.

## Störungen

Störungen verbiegen das Modell so, dass die vom `seed` angelegten Regeln
sicher auslösen. Welche Geräte betroffen sind, ist deterministisch, nämlich
die ersten N passenden in Flottenreihenfolge.

| Typ               | Ziel (Standard) | Wirkung                                                                                | Löst aus                                                                          |
| ----------------- | --------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `overheat`        | `rooms`         | Raum steigt binnen ein bis zwei Minuten auf 32 °C                                      | Schwellwertregel Raumtemperatur über 28 °C, `CRITICAL`                            |
| `spread_collapse` | `boilers`       | Hydraulischer Kurzschluss, Rücklauf fast so heiß wie der Vorlauf, Vorlauf steigt auf 68 °C | Schwellwertregel Rücklauf über 62 °C, `WARNING`                               |
| `short_cycle`     | `boilers`       | Pumpe taktet alle zwei Minuten ein und aus, 30 Starts je Stunde                        | Anomalieregel `short_cycle` im analytics-service, nach rund 15 Minuten Puffer     |
| `stuck`           | `any`           | Werte frieren ein, die Uhr läuft weiter                                                | Datenqualität, keine Regel                                                        |
| `dropout`         | `any`           | Gerät sendet nichts mehr                                                               | Verfügbarkeit, in der Flottenansicht später veraltet und offline                  |

`any` meint alle angelegten Geräte. Unbekannte Geräte sind nie Ziel einer
Störung.

## Last

Im Dauerbetrieb entstehen je Takt `sites * (1 + 2 * rooms)` Nachrichten,
dazu alle zehn Takte eine Batterienachricht je Raumsensor. Messwerte je Takt
sind `sites * (4 + 2 * rooms)`, ohne Batterie.

| Flotte                    | Takt | Nachrichten je Sekunde | Messwerte je Sekunde |
| ------------------------- | ---- | ---------------------- | -------------------- |
| 2 Standorte, 2 Räume      | 10 s | 1                      | 1,6                  |
| 25 Standorte, 3 Räume     | 10 s | 17,5                   | 25                   |
| 100 Standorte, 5 Räume    | 10 s | 110                    | 140                  |

Die Flotte sendet über wenige MQTT-Verbindungen, deshalb sind tausende
Geräte günstig. Die Geräte starten gleichmäßig über den ersten Takt
verteilt, damit die Last gleichmäßig ist und nicht in Schüben kommt. Kommt
der Broker nicht hinterher, wächst die interne Warteschlange bis 20.000
Nachrichten, danach zählt `dropped`.
