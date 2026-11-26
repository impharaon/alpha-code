#!/usr/bin/env python3
"""Per-file case counts from the JUnit reports `bin/check` wrote (ADR-0014).

Usage: python3 scripts/junit-file-counts.py <report dir>

Reads every `<step>.<layer>.xml` in <report dir> (bun's junit reporter). The step names its workdir: `<package>` or
`<package>+<group>`, where <package> is the directory under packages/ (the .gate-tests runner command). Prints one line per test
file: `<workdir>\t<file>\t<pass>\t<fail>\t<skip>`, file relative to the workdir. A file that appears in two reports of
the same workdir is printed once per report, so the caller can tell "ran twice" from "ran once".
"""
import pathlib
import sys
import xml.etree.ElementTree as ElementTree

LAYERS = ("fast", "integration", "scenario")


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    report_dir = pathlib.Path(sys.argv[1])
    for report in sorted(report_dir.glob("*.xml")):
        parts = report.name.split(".")
        if len(parts) != 3 or parts[1] not in LAYERS:
            continue
        workdir = "packages/" + parts[0].split("+", 1)[0]
        try:
            root = ElementTree.parse(report).getroot()
        except (ElementTree.ParseError, OSError) as error:
            print(f"::error::unreadable test report {report.name}: {error}", file=sys.stderr)
            return 1
        counts: dict[str, list[int]] = {}
        for suite in root.findall("testsuite"):  # one top-level testsuite per file
            name = suite.get("file") or suite.get("name") or ""
            tally = counts.setdefault(name, [0, 0, 0])
            for case in suite.iter("testcase"):
                if case.find("skipped") is not None:
                    tally[2] += 1
                elif case.find("failure") is not None or case.find("error") is not None:
                    tally[1] += 1
                else:
                    tally[0] += 1
        for name, (passed, failed, skipped) in counts.items():
            print(f"{workdir}\t{name}\t{passed}\t{failed}\t{skipped}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
