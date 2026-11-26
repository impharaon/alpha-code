#!/usr/bin/env python3
"""Split one bun JUnit report into one report per test layer (ADR-0014).

Usage: python3 scripts/junit-split-layers.py <junit.xml> <workdir> <out dir> <step>

The second argument is the package workdir. Report layers come from .gate-tests.
"""
import fnmatch
import json
import pathlib
import sys
import xml.etree.ElementTree as ElementTree


def main() -> int:
    if len(sys.argv) != 5:
        print(__doc__, file=sys.stderr)
        return 2
    report, workdir, out_dir, step = sys.argv[1:]
    repo = pathlib.Path(__file__).resolve().parent.parent
    runners = json.loads((repo / ".gate-tests").read_text())["runners"]
    try:
        root = ElementTree.parse(report).getroot()
    except (ElementTree.ParseError, OSError) as error:
        print(f"::error::junit-split-layers: unreadable report {report}: {error}", file=sys.stderr)
        return 1
    by_layer: dict[str, list[ElementTree.Element]] = {}
    unmapped = []
    for suite in root.findall("testsuite"):
        name = (suite.get("file") or suite.get("name") or "").removeprefix("./")
        path = f"{workdir}/{name}"
        layers = next((runner["layers"] for runner in runners
                       if path.startswith(runner["root"] + "/") or fnmatch.fnmatchcase(path, runner["root"])), {})
        layer = next((layer for layer, patterns in layers.items()
                      if any(fnmatch.fnmatchcase(path, p) for p in patterns if not p.startswith("!"))
                      and not any(fnmatch.fnmatchcase(path, p[1:]) for p in patterns if p.startswith("!"))), None)
        if layer is None:
            unmapped.append(name)
            continue
        by_layer.setdefault(layer, []).append(suite)
    if unmapped:
        print(f"::error::junit-split-layers: {step}: files with no declared report layer: {', '.join(unmapped)}", file=sys.stderr)
        return 1
    for layer, suites in by_layer.items():
        out = ElementTree.Element("testsuites", {"name": root.get("name") or "bun test"})
        totals = {"tests": 0, "failures": 0, "skipped": 0}
        seconds = 0.0
        for suite in suites:
            out.append(suite)
            for key in totals:
                totals[key] += int(suite.get(key) or 0)
            seconds += float(suite.get("time") or 0)
        for key, value in totals.items():
            out.set(key, str(value))
        out.set("time", f"{seconds:.6f}")
        ElementTree.ElementTree(out).write(pathlib.Path(out_dir) / f"{step}.{layer}.xml", encoding="utf-8", xml_declaration=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
