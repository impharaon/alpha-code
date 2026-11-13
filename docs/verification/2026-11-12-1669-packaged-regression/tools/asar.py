# alpha-code#1669 r5: minimal read-only asar reader (inspect a packaged app as data, never execute from it).
#   python3 -I asar.py list <app.asar> [path prefix]
#   python3 -I asar.py cat  <app.asar> <path inside> <output file>
import json, struct, sys


def header(f):
    f.seek(0)
    b = f.read(16)
    size = struct.unpack("<I", b[4:8])[0]
    jlen = struct.unpack("<I", b[12:16])[0]
    f.seek(16)
    return json.loads(f.read(jlen)), 8 + size


def walk(node, prefix=""):
    for k, v in node.get("files", {}).items():
        p = prefix + "/" + k
        if "files" in v:
            yield from walk(v, p)
        else:
            yield p, v


cmd, path = sys.argv[1], sys.argv[2]
with open(path, "rb") as f:
    h, base = header(f)
    if cmd == "list":
        pre = sys.argv[3] if len(sys.argv) > 3 else ""
        for p, v in walk(h):
            if p.startswith(pre):
                print(p, v.get("size"), "unpacked" if v.get("unpacked") else "")
    elif cmd == "extract":
        # extract <app.asar> <out dir> <prefix>...  (packed files only; unpacked ones live in app.asar.unpacked)
        import os
        out, prefixes = sys.argv[3], sys.argv[4:]
        n = 0
        for p, v in walk(h):
            if v.get("unpacked") or "offset" not in v or not any(p.startswith(x) for x in prefixes):
                continue
            dest = os.path.join(out, p.lstrip("/"))
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            f.seek(base + int(v["offset"]))
            with open(dest, "wb") as o:
                o.write(f.read(v["size"]))
            n += 1
        print("extracted", n)
    elif cmd == "cat":
        want = sys.argv[3]
        for p, v in walk(h):
            if p == want:
                f.seek(base + int(v["offset"]))
                with open(sys.argv[4], "wb") as o:
                    o.write(f.read(v["size"]))
                print("ok", v["size"])
                break
        else:
            print("not found")
