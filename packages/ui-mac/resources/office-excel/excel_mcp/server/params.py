# Adapted for Code Puppy, 2026-11-26, from excel-mcp-server 2.3.2 (MIT).
"""Parameter types shared by the tools, with the descriptions clients show the model."""
from typing import Annotated
from pydantic import Field
WorkbookPath = str
SheetName = str
CellRef = str
RangeRef = str
LineIndex = Annotated[int, Field(ge=1, description='1-based row, or column number (A=1).')]
LineCount = Annotated[int, Field(ge=1)]
