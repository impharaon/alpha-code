#!/usr/bin/env python3 -I
# alpha-code#1669 r3 (owner decision 「办法1」): guard for the shared preferences domain com.tide.codepuppy.
#   prefs-guard.py snapshot <plist> <private copy path>   copy the file byte-for-byte (nothing printed but key names/types)
#   prefs-guard.py compare  <plist> <private copy path>   exit 0 = allowed, 1 = stop the run
# Stops on: new key, removed key, value TYPE change, file size change, or the file appearing/disappearing.
# A changed value is reported by key name only (values are compared in memory, never printed).
import os, plistlib, shutil, sys

KNOWN_TIMESTAMP = "SKPurchaseIntentUpdatesLastChecked"

def load(path):
    with open(path, "rb") as f:
        return plistlib.load(f)

cmd, live, copy = sys.argv[1], sys.argv[2], sys.argv[3]
if cmd == "snapshot":
    if not os.path.exists(live):
        open(copy + ".absent", "w").close()
        print("prefs snapshot: file absent")
        sys.exit(0)
    shutil.copy2(live, copy)
    os.chmod(copy, 0o600)
    d = load(copy)
    print(f"prefs snapshot: size={os.path.getsize(copy)} keys={sorted(d)} types={ {k: type(v).__name__ for k, v in sorted(d.items())} }")
    sys.exit(0)
if cmd == "compare":
    was_absent = os.path.exists(copy + ".absent")
    if was_absent or not os.path.exists(live):
        same = was_absent and not os.path.exists(live)
        print(f"prefs compare: {'still absent' if same else 'file appeared or disappeared'}")
        sys.exit(0 if same else 1)
    a, b = load(copy), load(live)
    stop = []
    added, removed = sorted(set(b) - set(a)), sorted(set(a) - set(b))
    if added: stop.append(f"new keys {added}")
    if removed: stop.append(f"removed keys {removed}")
    retyped = sorted(k for k in set(a) & set(b) if type(a[k]) is not type(b[k]))
    if retyped: stop.append(f"type changed {retyped}")
    sa, sb = os.path.getsize(copy), os.path.getsize(live)
    if sa != sb: stop.append(f"size {sa} -> {sb}")
    changed = sorted(k for k in set(a) & set(b) if a[k] != b[k])
    unchanged = sorted(k for k in set(a) & set(b) if a[k] == b[k])
    print(f"prefs compare: size {sa}->{sb}; changed={changed}; unchanged={unchanged}; other-than-known-timestamp-changed={[k for k in changed if k != KNOWN_TIMESTAMP]}")
    if stop:
        print("PREFS GUARD RED: " + "; ".join(stop))
        sys.exit(1)
    sys.exit(0)
sys.exit(2)
