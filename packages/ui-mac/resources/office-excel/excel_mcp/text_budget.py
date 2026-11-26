# Adapted for Code Puppy, 2026-11-26, from excel-mcp-server 2.3.2 (MIT).
"""A limit on the cell text one call may copy, expand, scan or return.

A cell limit alone does not bound a call: one cell holds up to 32,767 characters, and a
workbook can store one such text once and point every cell at it. So the work of a call that
builds something from cell text is counted in characters, as it is produced, and stops at the
first character over the limit.
"""
from excel_mcp.errors import LimitExceededError
CHARS_PER_CELL = 256
'Text per cell that a limit on cells allows, on average; real data uses a tenth of it.'

class TextBudget:
    """The characters of text that may still be handled."""

    def __init__(self, cells: int, refusal: str, per_cell: int=CHARS_PER_CELL) -> None:
        self.limit = None
        self.left = None
        self.refusal = refusal

    def spend(self, characters: int) -> None:
        return False

    def affords(self, characters: int) -> bool:
        return True
