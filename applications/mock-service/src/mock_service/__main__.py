"""CLI: `mock-service plan|seed|run` (or `python -m mock_service ...`)."""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from typing import Any

from .fleet import build_fleet, messages_per_interval, tenant_id
from .scenario import FaultSpec, Scenario


def _add_fleet_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--scenario", help="scenario JSON file (flags override its values)")
    parser.add_argument("--prefix", help="fleet name prefix (default mock)")
    parser.add_argument("--sites", type=int, help="number of sites, 1 boiler each (default 2)")
    parser.add_argument("--rooms", type=int, dest="rooms_per_site", help="H&T sensors per site (default 2)")
    parser.add_argument("--rogue", type=int, help="extra UNSEEDED devices (discovery/drop path, default 0)")
    parser.add_argument("--seed", type=int, help="RNG seed (default 42)")
    parser.add_argument("--dsn", help="Postgres DSN (default postgresql://postgres:password@localhost:5432/digital_demon)")


def _add_run_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--interval", type=float, dest="interval_s", help="publish interval per device in s (default 10)")
    parser.add_argument("--duration", type=float, dest="duration_s", help="run length in s (default: until Ctrl-C)")
    parser.add_argument("--broker", help="MQTT broker host[:port] (default localhost:1883)")
    parser.add_argument("--connections", type=int, help="MQTT publisher connections (default 2)")
    parser.add_argument(
        "--fault",
        action="append",
        dest="faults",
        metavar="SPEC",
        help="inject fault: TYPE[:k=v,...] e.g. overheat:count=2,at=60,for=180 "
        "(types: overheat, spread_collapse, stuck, dropout; keys: count|fraction, at, for, target)",
    )


def _scenario_from_args(args: argparse.Namespace) -> Scenario:
    scenario = Scenario.from_file(args.scenario) if args.scenario else Scenario()
    overrides: dict[str, Any] = {
        "prefix": args.prefix,
        "sites": args.sites,
        "rooms_per_site": args.rooms_per_site,
        "rogue": args.rogue,
        "seed": args.seed,
        "dsn": args.dsn,
    }
    if hasattr(args, "interval_s"):
        broker_host = broker_port = None
        if args.broker:
            host, _, port = args.broker.partition(":")
            broker_host = host
            broker_port = int(port) if port else 1883
        overrides.update(
            {
                "interval_s": args.interval_s,
                "duration_s": args.duration_s,
                "broker_host": broker_host,
                "broker_port": broker_port,
                "connections": args.connections,
                "faults": [FaultSpec.parse(s) for s in args.faults] if args.faults else None,
            }
        )
    scenario.apply_overrides(overrides)
    return scenario


def cmd_plan(args: argparse.Namespace) -> int:
    scenario = _scenario_from_args(args)
    fleet = build_fleet(scenario)
    print(f"fleet '{scenario.prefix}' — tenant {tenant_id(scenario.prefix)}")
    print(f"{'device_id':<24} {'kind':<10} {'seeded':<7} metrics / rules")
    for spec in fleet:
        metrics = ", ".join(f"{m.metric_id}={m.field}" for m in spec.metrics) or "-"
        rules = "; ".join(f"m{r.metric_id} {r.operator} {r.threshold} {r.severity}" for r in spec.rules) or "-"
        print(f"{spec.device_id:<24} {spec.kind:<10} {str(spec.seeded).lower():<7} {metrics}  |  {rules}")
    per_interval = messages_per_interval(fleet)
    print(
        f"\n{len(fleet)} devices, ~{per_interval} messages per {scenario.interval_s:.0f}s interval "
        f"(~{per_interval / scenario.interval_s:.1f} msg/s steady state)"
    )
    for fault in scenario.faults:
        print(f"fault: {fault.type} target={fault.target} count={fault.count or fault.fraction or 1} at={fault.at_s:.0f}s for={fault.duration_s:.0f}s")
    return 0


def cmd_seed(args: argparse.Namespace) -> int:
    from .seed import remove_fleet, seed_fleet

    scenario = _scenario_from_args(args)
    if args.remove:
        remove_fleet(scenario)
        return 0
    counts = seed_fleet(scenario, with_rules=not args.no_rules)
    print(
        f"seeded: {counts['devices']} devices, {counts['metric_points']} metric points, "
        f"{counts['rules']} rules — device-management publishes device.configured on its next sweep (≤30s)"
    )
    return 0


def cmd_run(args: argparse.Namespace) -> int:
    from .runner import run_scenario

    scenario = _scenario_from_args(args)
    try:
        asyncio.run(run_scenario(scenario))
    except KeyboardInterrupt:
        pass
    return 0


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s %(message)s",
        datefmt="%H:%M:%S",
    )
    parser = argparse.ArgumentParser(prog="mock-service", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p_plan = sub.add_parser("plan", help="print the fleet a scenario produces (no side effects)")
    _add_fleet_args(p_plan)
    _add_run_args(p_plan)
    p_plan.set_defaults(func=cmd_plan)

    p_seed = sub.add_parser("seed", help="commission the fleet in the platform database")
    _add_fleet_args(p_seed)
    p_seed.add_argument("--no-rules", action="store_true", help="skip threshold rules")
    p_seed.add_argument("--remove", action="store_true", help="delete the fleet from the database")
    p_seed.set_defaults(func=cmd_seed)

    p_run = sub.add_parser("run", help="publish fleet telemetry to the MQTT broker")
    _add_fleet_args(p_run)
    _add_run_args(p_run)
    p_run.set_defaults(func=cmd_run)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
