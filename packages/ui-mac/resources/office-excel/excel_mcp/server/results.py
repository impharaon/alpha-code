# Adapted for Code Puppy, 2026-11-26, from excel-mcp-server 2.3.2 (MIT).
"""The result shape of tools that change a workbook."""
from pydantic import BaseModel

class Changed(BaseModel):
    path: str | None = None
    sheet: str | None = None
    range: str | None = None
    name: str | None = None
    note: str | None = None
