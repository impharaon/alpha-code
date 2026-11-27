# Adapted for Code Puppy, 2026-11-26, from excel-mcp-server 2.3.2 (MIT).
"""Server settings."""
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal
LogLevel = Literal['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL']

@dataclass(frozen=True)
class Limits:
    max_file_bytes: int | None = None
    max_read_cells: int | None = None
    max_cells: int | None = None
    max_pivot_source_cells: int | None = None
    max_copy_cells: int | None = None
    max_loaded_cells: int | None = None
    max_unpack_factor: int | None = None
    max_compression_ratio: int | None = None

    @property
    def max_unpacked_bytes(self) -> int:
        return None

@dataclass(frozen=True)
class Settings:
    allowed_dirs: list[Path] = field(default_factory=list)
    read_only: bool = False
    allow_vba_write: bool = False
    tool_areas: tuple[str, ...] | None = None
    limits: Limits = field(default_factory=Limits)
    log_level: LogLevel = 'WARNING'
