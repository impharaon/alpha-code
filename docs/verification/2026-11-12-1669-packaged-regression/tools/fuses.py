# alpha-code#1669 r5: read the Electron fuse wire from an Electron Framework binary (read-only, never executes it).
#   python3 -I fuses.py "<app>/Contents/Frameworks/Electron Framework.framework/Electron Framework"
import sys

SENTINEL = b"dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX"
NAMES = ["RunAsNode", "EnableCookieEncryption", "EnableNodeOptionsEnvironmentVariable", "EnableNodeCliInspectArguments",
         "EnableEmbeddedAsarIntegrityValidation", "OnlyLoadAppFromAsar", "LoadBrowserProcessSpecificV8Snapshot",
         "GrantFileProtocolExtraPrivileges"]
data = open(sys.argv[1], "rb").read()
i = data.find(SENTINEL)
if i < 0:
    sys.exit("sentinel not found")
j = i + len(SENTINEL)
version, length = data[j], data[j + 1]
wire = data[j + 2:j + 2 + length].decode("ascii")
print(f"fuse wire version={version} length={length} wire={wire!r} occurrences={data.count(SENTINEL)}")
for n, c in zip(NAMES, wire):
    print(f"  {n}: {'enabled' if c == '1' else 'disabled' if c == '0' else 'removed' if c == 'r' else c}")
