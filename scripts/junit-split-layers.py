#!/usr/bin/env python3
"""Split one bun JUnit report into one report per test layer (ADR-0014).

Usage: python3 scripts/junit-split-layers.py <junit.xml> <map.tsv> <out dir> <step>

<map.tsv> is `scripts/test-layers.sh map <workdir> <layer...>` output: `<file>\t<layer>`, the file relative to the
workdir, as bun writes it in each top-level <testsuite file=...>. Writes `<out dir>/<step>.<layer>.xml` for every layer
that has files in the report. A report file the map does not name is an error (the layer rule decides every file; a
file with no layer must not pass silently), and so is a missing or unreadable report.
"""
import pathlib
import sys
import xml.etree.ElementTree as ElementTree


def main() -> int:
    if len(sys.argv) != 5:
        print(__doc__, file=sys.stderr)
        return 2
    report, mapping, out_dir, step = sys.argv[1:]
    layer_of = {}
    for line in pathlib.Path(mapping).read_text().splitlines():
        if line.strip():
            path, layer = line.split("\t")
            layer_of[path.removeprefix("./")] = layer
    try:
        root = ElementTree.parse(report).getroot()
    except (ElementTree.ParseError, OSError) as error:
        print(f"::error::junit-split-layers: unreadable report {report}: {error}", file=sys.stderr)
        return 1
    by_layer: dict[str, list[ElementTree.Element]] = {}
    unmapped = []
    for suite in root.findall("testsuite"):
        name = (suite.get("file") or suite.get("name") or "").removeprefix("./")
        layer = layer_of.get(name)
        if layer is None:
            unmapped.append(name)
            continue
        by_layer.setdefault(layer, []).append(suite)
    if unmapped:
        print(f"::error::junit-split-layers: {step}: files with no layer in the map: {', '.join(unmapped)}", file=sys.stderr)
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
