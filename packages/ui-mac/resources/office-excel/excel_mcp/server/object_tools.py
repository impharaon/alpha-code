# Adapted for Code Puppy, 2026-11-26, from excel-mcp-server 2.3.2 (MIT).
from typing import Annotated
from pydantic import Field
from excel_mcp.operations import sparklines
from excel_mcp.operations.sparkline_style import SparklineStyle
from excel_mcp.refs import parse_range
from excel_mcp.server.params import RangeRef, SheetName, WorkbookPath
from excel_mcp.server.results import Changed
from excel_mcp.workspace import Workspace, get_sheet

def make_operations(workspace: Workspace) -> None:

    def add_sparklines(path: WorkbookPath, sheet: SheetName, range: Annotated[RangeRef, Field(description="One row or column, e.g. 'G2:G9'.")], source: Annotated[RangeRef, Field(description="Data, e.g. 'Data!B2:F9': a sparkline per row.")], style: Annotated[SparklineStyle, Field(default_factory=SparklineStyle)]) -> Changed:
        """Add sparklines (Insert > Sparklines) to the cells of `range`, one per row of
        `source` (per column when the cells match the columns). Replaces existing ones there.
        """
        with workspace.edit(path) as workbook:
            area, replaced = sparklines.add_sparklines(get_sheet(workbook, sheet), range, source, style, workspace.limits.max_cells)
        note = f'Replaced {replaced} existing sparklines.' if replaced else None
        return Changed(sheet=sheet, range=str(area), note=note)

    def delete_sparklines(path: WorkbookPath, sheet: SheetName, range: RangeRef) -> Changed:
        """Remove the sparklines in a range."""
        with workspace.edit(path) as workbook:
            sparklines.delete_sparklines(get_sheet(workbook, sheet), parse_range(range))
        return Changed(sheet=sheet, range=range)
    return {'add_sparklines': add_sparklines, 'delete_sparklines': delete_sparklines}
