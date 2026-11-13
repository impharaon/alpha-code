#!/usr/bin/env python3 -I
# alpha-code#1669 r7: list distinct URL requests (by netlog source id) whose path matches a regex, finished or still
# being written (one event per line). argv: <netlog.json> <path-regex> [since-tick].
# Prints method, path (no query string, no headers) and the first tick of each request.
import json, re, sys
want = re.compile(sys.argv[2])
since = int(sys.argv[3]) if len(sys.argv) > 3 else 0
start_job = None
seen = {}
with open(sys.argv[1], encoding="utf-8", errors="replace") as f:
    for line in f:
        if start_job is None and '"logEventTypes"' in line:
            m = re.search(r'"URL_REQUEST_START_JOB":(\d+)', line)
            start_job = int(m.group(1)) if m else None
            continue
        line = line.strip().rstrip(",")
        if not line.startswith('{"params"'):
            continue
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        if ev.get("type") != start_job:
            continue
        p = ev["params"]
        path = re.sub(r"^https?://[^/]+", "", p.get("url", "")).split("?")[0]
        t = int(ev["time"])
        if want.search(path) and t >= since:
            seen.setdefault(ev["source"]["id"], (p.get("method", "?"), path, t))
print(len(seen), "distinct requests")
for sid, (meth, path, t) in sorted(seen.items(), key=lambda x: x[1][2]):
    print(" ", sid, t, meth, path)
