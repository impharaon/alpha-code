# Syscall-level probe helper for #1530 (revised C2 plan). Runs INSIDE sandbox-exec with `python3 -I -B`.
# usage: syscall-probe.py swap <a> <b>        renamex_np(a, b, RENAME_SWAP)
#        syscall-probe.py exchange <a> <b>    exchangedata(a, b, 0)
#        syscall-probe.py openat <dir> <name> open(name, O_WRONLY|O_CREAT|O_APPEND, dir_fd=open(dir))
#        syscall-probe.py renameat <dir> <src> <dst>  rename(src, dst) relative to dir fd
import ctypes
import errno
import json
import os
import sys

RENAME_SWAP = 0x2


def name(code: int) -> str:
    return errno.errorcode.get(code, f"errno={code}")


def main() -> None:
    action, *args = sys.argv[1:]
    lib = ctypes.CDLL(None, use_errno=True)
    try:
        if action == "swap":
            a, b = args
            rc = lib.renamex_np(a.encode(), b.encode(), RENAME_SWAP)
            out = "OK" if rc == 0 else name(ctypes.get_errno())
        elif action == "exchange":
            a, b = args
            rc = lib.exchangedata(a.encode(), b.encode(), 0)
            out = "OK" if rc == 0 else name(ctypes.get_errno())
        elif action == "openat":
            directory, entry = args
            dfd = os.open(directory, os.O_RDONLY)
            try:
                fd = os.open(entry, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600, dir_fd=dfd)
                os.write(fd, b"probe\n")
                os.close(fd)
                out = "OK"
            finally:
                os.close(dfd)
        elif action == "renameat":
            directory, src, dst = args
            dfd = os.open(directory, os.O_RDONLY)
            try:
                os.rename(src, dst, src_dir_fd=dfd, dst_dir_fd=dfd)
                out = "OK"
            finally:
                os.close(dfd)
        else:
            raise SystemExit(f"unknown action {action}")
    except OSError as error:
        out = name(error.errno)
    print(json.dumps({"action": action, "code": out}))


main()
