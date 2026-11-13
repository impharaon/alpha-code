#!/usr/bin/env python3 -I
# alpha-code#1669: count Chromium socket-pool stalls (6-per-origin limit) in a netlog, finished or still being written.
# argv: <netlog.json>. Prints counts and the stalled groups; never prints URLs' query strings or headers.
import json, re, sys
txt = open(sys.argv[1], encoding="utf-8", errors="replace").read()
m = re.search(r'"logEventTypes"\s*:\s*(\{[^}]*\})', txt)
types = json.loads(m.group(1))
sid = types["SOCKET_POOL_STALLED_MAX_SOCKETS_PER_GROUP"]
pat = re.compile(r'\{"params":\{"group_name":"([^"]*)"[^{}]*\},"phase":\d+,"source":\{[^{}]*\},"time":"(\d+)","type":%d\}' % sid)
hits = pat.findall(txt)
groups = {}
for g, t in hits:
    groups.setdefault(g, []).append(int(t))
print(f"SOCKET_POOL_STALLED_MAX_SOCKETS_PER_GROUP events: {len(hits)}")
for g, ts in groups.items():
    print(f"  group {g}: {len(ts)} stalls, first tick {min(ts)}, last tick {max(ts)}")
if not hits:
    ends = [mm.end() for mm in re.finditer(r'"type":%d\}' % sid, txt)]
    loose = {}
    for e in ends:
        start = txt.rfind('{"params"', 0, e) if txt.rfind('{"params"', 0, e) > e - 600 else txt.rfind('{', 0, e - 20)
        chunk = txt[max(0, e - 600):e]
        g = re.findall(r'"group_name":"([^"]*)"', chunk)
        t = re.findall(r'"time":"(\d+)"', chunk)
        key = g[-1] if g else "?"
        loose.setdefault(key, []).append(int(t[-1]) if t else -1)
    print(f"  loose scan: {len(ends)} stall events")
    for g, ts in loose.items():
        print(f"  group {g}: {len(ts)} stalls, ticks {min(ts)}..{max(ts)}")
    c = re.search(r'"tickOffset"\s*:\s*"(\d+)"', txt)
    print("  constants.timeTickOffset (ms since epoch at tick 0):", c.group(1) if c else "?")
