"""Device-fleet mock for the heating-monitoring platform.

Stands in for the "edge device" of the C4 diagram: simulated heating sites
(boiler controller + Shelly H&T room sensors) publish realistic telemetry to
the MQTT broker. Used for functional E2E runs and for load/scenario
evaluation of the platform (thesis FF3). Not to be confused with the
simulation-engine, which will be the digital-twin/prediction service.
"""

__version__ = "0.1.0"
