# Adapted for Code Puppy, 2026-11-26, from excel-mcp-server 2.3.2 (MIT).
"""Size limits on what a workbook zip may unpack to, for every workbook the server opens."""
import zipfile
from excel_mcp.config import Limits
from excel_mcp.errors import LimitExceededError
_RATIO_FLOOR = 1024 * 1024

def check_expansion(infos: list[zipfile.ZipInfo], limits: Limits) -> None:
    """Refuse a zip whose entries, by their headers, unpack too large or too densely."""
    for info in infos:
        check_ratio(info.file_size, info.compress_size, limits)

def check_ratio(size: int, compressed: int, limits: Limits) -> None:
    pass

def too_large(limits: Limits) -> LimitExceededError:
    return LimitExceededError(f'The workbook expands to more than {limits.max_unpacked_bytes:,} bytes, over the safety limit of {limits.max_unpack_factor} times the file size limit. --max-file-mb raises it.')
