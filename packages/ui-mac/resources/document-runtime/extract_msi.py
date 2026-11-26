"""Read-only MSI/CAB extraction; no installation sequence or custom actions.

Uses Windows Installer database and Cabinet FDI APIs. Windows real-package execution
is pending; the Mac build must never claim to have exercised these Win32 calls.
"""
import ctypes
from ctypes import wintypes
import os
from pathlib import Path, PureWindowsPath
import sys
import tempfile


def inside(root, name):
    relative = PureWindowsPath(name)
    if relative.is_absolute() or relative.drive or any(part in ('..', '.') for part in relative.parts):
        raise ValueError('MSI path escapes private root: ' + name)
    path = (root / Path(*relative.parts)).resolve()
    path.relative_to(root)
    return path


def long_name(value):
    return value.split('|')[-1]


def extract(source, destination):
    if sys.platform != 'win32':
        raise OSError('MSI extraction requires Windows')
    root = Path(destination).resolve(strict=True)
    msi = ctypes.WinDLL('msi', use_last_error=True)
    uint = wintypes.UINT
    handle = uint
    msi.MsiOpenDatabaseW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR, ctypes.POINTER(handle)]
    msi.MsiDatabaseOpenViewW.argtypes = [handle, wintypes.LPCWSTR, ctypes.POINTER(handle)]
    msi.MsiViewExecute.argtypes = [handle, handle]
    msi.MsiViewFetch.argtypes = [handle, ctypes.POINTER(handle)]
    msi.MsiRecordGetStringW.argtypes = [handle, uint, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
    msi.MsiRecordReadStream.argtypes = [handle, uint, ctypes.c_void_p, ctypes.POINTER(wintypes.DWORD)]
    msi.MsiCloseHandle.argtypes = [handle]

    def check(code):
        if code != 0:
            raise OSError(code, 'Windows Installer read-only query failed')

    def rows(sql, columns):
        view = handle()
        check(msi.MsiDatabaseOpenViewW(database, sql, ctypes.byref(view)))
        try:
            check(msi.MsiViewExecute(view, 0))
            while True:
                record = handle()
                code = msi.MsiViewFetch(view, ctypes.byref(record))
                if code == 259:
                    return
                check(code)
                try:
                    values = []
                    for column in range(1, columns + 1):
                        size = wintypes.DWORD(0)
                        code = msi.MsiRecordGetStringW(record, column, None, ctypes.byref(size))
                        if code not in (0, 234):
                            check(code)
                        size.value += 1
                        buffer = ctypes.create_unicode_buffer(size.value)
                        check(msi.MsiRecordGetStringW(record, column, buffer, ctypes.byref(size)))
                        values.append(buffer.value)
                    yield values
                finally:
                    msi.MsiCloseHandle(record)
        finally:
            msi.MsiCloseHandle(view)

    database = handle()
    check(msi.MsiOpenDatabaseW(str(Path(source).resolve(strict=True)), None, ctypes.byref(database)))
    try:
        directories = {key: (parent, long_name(name.split(':')[0])) for key, parent, name in rows('SELECT `Directory`, `Directory_Parent`, `DefaultDir` FROM `Directory`', 3)}
        components = {key: directory for key, directory in rows('SELECT `Component`, `Directory_` FROM `Component`', 2)}
        file_rows = list(rows('SELECT `File`, `Component_`, `FileName`, `FileSize`, `Sequence` FROM `File`', 5))
        programs = [components[component] for _, component, name, _, _ in file_rows if long_name(name).casefold() == 'soffice.com']
        if len(programs) != 1:
            raise ValueError('MSI must identify one LibreOffice console executable')
        application_root = directories[programs[0]][0]
        def directory(key, ancestry=()):
            if key in ancestry:
                raise ValueError('cyclic MSI directory relationship')
            parent, name = directories[key]
            if not parent or key == application_root:
                return root
            base = directory(parent, ancestry + (key,))
            return base if name == '.' else inside(base, name)
        files = {}
        for key, component, name, size, sequence in file_rows:
            path = inside(root, str(directory(components[component]).relative_to(root) / long_name(name)))
            if path in [item[0] for item in files.values()]:
                raise ValueError('duplicate MSI output path')
            files[key] = (path, int(size), int(sequence))
        media = list(rows('SELECT `LastSequence`, `Cabinet` FROM `Media` ORDER BY `DiskId`', 2))
        with tempfile.TemporaryDirectory(dir=root) as scratch:
            for last, cabinet in media:
                if not cabinet.startswith('#'):
                    raise ValueError('external CAB is not a pinned MSI stream: ' + cabinet)
                stream = cabinet[1:]
                if "'" in stream:
                    raise ValueError('invalid MSI stream name')
                view = handle()
                check(msi.MsiDatabaseOpenViewW(database, "SELECT `Data` FROM `_Streams` WHERE `Name`='" + stream + "'", ctypes.byref(view)))
                try:
                    check(msi.MsiViewExecute(view, 0))
                    record = handle()
                    check(msi.MsiViewFetch(view, ctypes.byref(record)))
                    try:
                        cab = Path(scratch) / 'payload.cab'
                        with cab.open('wb') as output:
                            while True:
                                buffer = ctypes.create_string_buffer(1024 * 1024)
                                size = wintypes.DWORD(len(buffer))
                                check(msi.MsiRecordReadStream(record, 1, buffer, ctypes.byref(size)))
                                if not size.value:
                                    break
                                output.write(buffer.raw[:size.value])
                    finally:
                        msi.MsiCloseHandle(record)
                    extract_cab(cab, files, int(last))
                finally:
                    msi.MsiCloseHandle(view)
        for path, size, _ in files.values():
            if path.stat().st_size != size:
                raise ValueError('MSI extracted length mismatch: ' + str(path))
    finally:
        msi.MsiCloseHandle(database)


def extract_cab(cab, files, last_sequence):
    cabinet = ctypes.CDLL('cabinet')
    crt = ctypes.CDLL('msvcrt')
    pointer = ctypes.c_void_p
    intptr = ctypes.c_ssize_t
    crt.malloc.argtypes = [ctypes.c_size_t]; crt.malloc.restype = pointer
    crt.free.argtypes = [pointer]
    crt._wopen.argtypes = [wintypes.LPCWSTR, ctypes.c_int, ctypes.c_int]; crt._wopen.restype = ctypes.c_int
    crt._read.argtypes = [ctypes.c_int, pointer, ctypes.c_uint]; crt._read.restype = ctypes.c_int
    crt._write.argtypes = [ctypes.c_int, pointer, ctypes.c_uint]; crt._write.restype = ctypes.c_int
    crt._close.argtypes = [ctypes.c_int]
    crt._lseek.argtypes = [ctypes.c_int, ctypes.c_long, ctypes.c_int]; crt._lseek.restype = ctypes.c_long
    alloc = ctypes.CFUNCTYPE(pointer, ctypes.c_ulong)(crt.malloc)
    free = ctypes.CFUNCTYPE(None, pointer)(crt.free)
    # FDI passes through our UTF-8 cabinet directory; CRT opens Unicode paths.
    opened = ctypes.CFUNCTYPE(intptr, ctypes.c_char_p, ctypes.c_int, ctypes.c_int)(lambda path, flags, mode: crt._wopen(path.decode('utf-8'), flags, mode))
    read = ctypes.CFUNCTYPE(ctypes.c_uint, intptr, pointer, ctypes.c_uint)(crt._read)
    write = ctypes.CFUNCTYPE(ctypes.c_uint, intptr, pointer, ctypes.c_uint)(crt._write)
    close = ctypes.CFUNCTYPE(ctypes.c_int, intptr)(crt._close)
    seek = ctypes.CFUNCTYPE(ctypes.c_long, intptr, ctypes.c_long, ctypes.c_int)(crt._lseek)
    class Error(ctypes.Structure):
        _fields_ = [('oper', ctypes.c_int), ('type', ctypes.c_int), ('error', ctypes.c_int)]
    class Notice(ctypes.Structure):
        _fields_ = [('cb', ctypes.c_long), ('psz1', ctypes.c_char_p), ('psz2', ctypes.c_char_p), ('psz3', ctypes.c_char_p), ('pv', pointer), ('hf', intptr), ('date', ctypes.c_ushort), ('time', ctypes.c_ushort), ('attribs', ctypes.c_ushort), ('setID', ctypes.c_ushort), ('iCabinet', ctypes.c_ushort), ('iFolder', ctypes.c_ushort), ('fdie', ctypes.c_int)]
    failure = []
    def notify(kind, data):
        try:
            info = data.contents
            if kind == 0 or kind == 1:  # cabinet info, partial file
                if kind == 1:
                    raise ValueError('CAB needs a different unpinned cabinet')
                return 0
            if kind == 2:  # COPY_FILE; CAB names are MSI File keys, not output paths.
                key = info.psz1.decode('utf-8' if info.attribs & 0x80 else 'mbcs')
                path, size, sequence = files[key]
                if sequence > last_sequence or size != info.cb:
                    raise ValueError('CAB/MSI relationship mismatch')
                path.parent.mkdir(parents=True, exist_ok=True)
                return crt._wopen(str(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_BINARY, 0o600)
            if kind == 3:
                return int(crt._close(info.hf) == 0)
            if kind == 4:
                raise ValueError('CAB requested another media file')
            return 0
        except Exception as error:
            failure.append(error)
            return -1
    callback = ctypes.CFUNCTYPE(intptr, ctypes.c_int, ctypes.POINTER(Notice))(notify)
    cabinet.FDICreate.argtypes = [type(alloc), type(free), type(opened), type(read), type(write), type(close), type(seek), ctypes.c_int, ctypes.POINTER(Error)]
    cabinet.FDICreate.restype = pointer
    cabinet.FDICopy.argtypes = [pointer, ctypes.c_char_p, ctypes.c_char_p, ctypes.c_int, type(callback), pointer, pointer]
    cabinet.FDIDestroy.argtypes = [pointer]
    error = Error()
    context = cabinet.FDICreate(alloc, free, opened, read, write, close, seek, 1, ctypes.byref(error))
    if not context:
        raise OSError('FDICreate failed')
    try:
        if not cabinet.FDICopy(context, os.fsencode(cab.name), os.fsencode(str(cab.parent) + os.sep), 0, callback, None, None):
            raise OSError('FDICopy failed: ' + str(error.oper))
        if failure:
            raise failure[0]
    finally:
        cabinet.FDIDestroy(context)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise ValueError('expected pinned MSI and private extraction root')
    extract(sys.argv[1], sys.argv[2])
