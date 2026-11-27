# Adapted for Code Puppy, 2026-11-26, from excel-mcp-server 2.3.2 (MIT).
"""Opening and saving workbooks safely."""
import io
import os
import tempfile
import threading
import zipfile
import zlib
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path
from typing import BinaryIO, TypeVar, cast
from xml.etree.ElementTree import ParseError
from openpyxl import Workbook, load_workbook
from openpyxl.chart import AreaChart
from openpyxl.workbook.properties import CalcProperties
from openpyxl.worksheet._read_only import ReadOnlyWorksheet
from openpyxl.worksheet.worksheet import Worksheet
from excel_mcp import cell_budget, chart_roundtrip, lazy_edit, package, shared_translator
from excel_mcp.cell_budget import CellBudget
from excel_mcp.config import Limits
from excel_mcp.errors import ExcelMCPError, InvalidArgumentError, LimitExceededError, SheetNotFoundError, WorkbookError, WorkbookExistsError, WorkbookNotFoundError
from excel_mcp.lazy_edit import LazyEdit
from excel_mcp.lazy_workbook import Parts, held_cells, load_lazy
from excel_mcp.package import lazy_records
from excel_mcp.paths import MACRO_SUFFIXES, TEMPLATE_SUFFIXES, PathPolicy
from excel_mcp.zip_limits import check_expansion, too_large
MAX_IMAGE_BYTES = 10 * 1024 * 1024
_edit_budget: ContextVar[CellBudget | None] = ContextVar('edit_budget', default=None)
Sheet = TypeVar('Sheet')

class Workspace:
    """Resolves client paths and gives access to workbooks within the limits.

    Changes are serialized: tools run in parallel threads, and each edit loads
    and saves the whole file, so concurrent edits would otherwise lose data.
    """

    def __init__(self, paths: PathPolicy, limits: Limits, allow_macro_workbooks: bool) -> None:
        chart_roundtrip.install()
        shared_translator.install()
        lazy_records.install()
        self.paths = paths
        self.limits = limits
        self.allow_macro_workbooks = allow_macro_workbooks
        self._write_lock = threading.Lock()

    def resolve(self, raw_path: str) -> Path:
        return self.paths.resolve(raw_path)

    def resolve_existing(self, raw_path: str) -> Path:
        path = self.resolve(raw_path)
        if not path.is_file():
            raise WorkbookNotFoundError(f'Workbook {self.display(path)} does not exist.')
        size = path.stat().st_size
        self._check_expansion(path)
        return path

    def _check_expansion(self, path: Path) -> None:
        if not zipfile.is_zipfile(path):
            return
        try:
            with zipfile.ZipFile(path) as archive:
                check_expansion(archive.infolist(), self.limits)
        except zipfile.BadZipFile:
            raise WorkbookError(f'{self.display(path)} is a damaged zip file.') from None

    def display(self, path: Path) -> str:
        return self.paths.display(path)

    @contextmanager
    def read(self, raw_path: str) -> Iterator[Workbook]:
        """Open a workbook as `edit` does, for readers of everything on a sheet but its cells;
        changes are never saved. The rows of a large sheet are parsed only where needed.
        """
        path = self.resolve_existing(raw_path)
        workbook, _ = self._load_for_edit(path, self._budget())
        package.capture(path, workbook, self.limits.max_file_bytes)
        try:
            with self._damage_as_error(path):
                yield workbook
        finally:
            close_workbook(workbook)

    @contextmanager
    def read_lazy(self, raw_path: str) -> Iterator[tuple[Workbook, Workbook]]:
        """Open a workbook as its stored results and its formulas, parsing cells when needed.

        For calculating some of a large sheet's formulas: only the rows that are asked for are
        read, so the cells they use are the only ones that cost anything. Changes are never saved.
        """
        path = self.resolve_existing(raw_path)
        self._check_zip(path)
        parts: Parts = {}
        budget = self._budget()
        try:
            stored = load_lazy(path, parts, budget, data_only=True)
            formulas = load_lazy(path, parts, budget, data_only=False)
        except Exception as error:
            raise self._unreadable(path, error) from None
        try:
            with self._damage_as_error(path):
                yield (stored, formulas)
        finally:
            close_workbook(stored)
            close_workbook(formulas)

    @contextmanager
    def stream(self, raw_path: str, *, data_only: bool=False) -> Iterator[Workbook]:
        """Open a workbook for streaming reads, which use constant memory on huge sheets.

        Its worksheets are openpyxl read-only views: they hold only cell values (no
        formatting, merged ranges, tables or charts) and re-parse the sheet on each pass.
        """
        path = self.resolve_existing(raw_path)
        if not data_only:
            self._check_zip(path)
            try:
                cell_budget.check_workbook(path, CellBudget(self.limits.max_loaded_cells), cells=False)
            except Exception as error:
                raise self._unreadable(path, error) from None
        with path.open('rb') as handle:
            workbook = self._load(path, handle, data_only=data_only, stream=True)
            try:
                with self._damage_as_error(path):
                    yield workbook
            finally:
                close_workbook(workbook)

    @contextmanager
    def edit(self, raw_path: str) -> Iterator[Workbook]:
        """Open a workbook and save it only if the block finishes without error."""
        with self._write_lock:
            path = self.resolve_existing(raw_path)
            from codepuppy_office.excel import file_digest, begin_edit, prepare_save
            original = file_digest(path)
            budget = CellBudget(self.limits.max_loaded_cells)
            workbook, lazy = self._load_for_edit(path, budget)
            _restore_area_chart_axes(workbook)
            package.capture(path, workbook, self.limits.max_file_bytes)
            workbook.calculation = workbook.calculation or CalcProperties()
            workbook.calculation.fullCalcOnLoad = True
            begin_edit(workbook, path, original)
            token = _edit_budget.set(budget)
            try:
                with self._damage_as_error(path):
                    yield workbook
                from excel_mcp.operations.spill import refresh_spills
                refresh_spills(workbook, self.limits.max_cells)
                _pin_hyperlinks(workbook)
                _check_text_size(workbook, self.limits)
                prepare_save(workbook)
                save_atomically(workbook, path, self.limits.max_file_bytes, lazy)
                self._codepuppy_result = workbook._codepuppy_edit["result"]
            finally:
                _edit_budget.reset(token)
                close_workbook(workbook)

    def _load(self, path: Path, handle: BinaryIO, *, data_only: bool, stream: bool=False) -> Workbook:
        self._check_zip(path)
        try:
            return load_workbook(handle, data_only=data_only, read_only=stream, keep_vba=not stream and path.suffix.lower() in MACRO_SUFFIXES)
        except Exception as error:
            raise self._unreadable(path, error) from None

    def _budget(self) -> CellBudget:
        """The budget of the edit that this call is part of, or else a new one."""
        return _edit_budget.get() or CellBudget(self.limits.max_loaded_cells)

    def _load_for_edit(self, path: Path, budget: CellBudget) -> tuple[Workbook, LazyEdit | None]:
        """Load for editing; a large sheet's rows are parsed only as far as the edit looks."""
        self._check_zip(path)
        if path.suffix.lower() in MACRO_SUFFIXES or not lazy_edit.has_large_sheet(path):
            try:
                cell_budget.check_workbook(path, budget)
            except Exception as error:
                raise self._unreadable(path, error) from None
            with path.open('rb') as handle:
                return (self._load(path, handle, data_only=False), None)
        try:
            return lazy_edit.load(path, budget)
        except Exception as error:
            raise self._unreadable(path, error) from None

    def _check_zip(self, path: Path) -> None:
        if not zipfile.is_zipfile(path):
            raise WorkbookError(f'{self.display(path)} is not an Excel workbook. Only .xlsx/.xlsm files are supported; legacy .xls and CSV files must be converted first.')

    @contextmanager
    def _damage_as_error(self, path: Path) -> Iterator[None]:
        """Parts are parsed as sheets are read, so damage surfaces after the workbook is open."""
        try:
            yield
        except (ParseError, zipfile.BadZipFile, zlib.error) as error:
            raise self._unreadable(path, error) from None

    def _unreadable(self, path: Path, error: Exception) -> ExcelMCPError:
        if isinstance(error, ExcelMCPError):
            return error
        return WorkbookError(f'{self.display(path)} could not be opened as an Excel workbook ({error}).')

def save_atomically(workbook: Workbook, path: Path, max_bytes: int, lazy: LazyEdit | None=None) -> None:
    """Serialize the workbook in memory, then write it atomically.

    A result larger than the size limit is refused, because the server could not open it again.
    """
    buffer = io.BytesIO()
    try:
        package.prepare(workbook)
        if lazy:
            lazy.freeze(workbook)
        workbook.save(buffer)
    except Exception as error:
        raise WorkbookError(f'Could not save the workbook: {error}') from None
    content = package.apply(workbook, buffer.getvalue())
    if lazy:
        content = lazy.merge(workbook, content)
    from codepuppy_office.excel import finish_edit
    finish_edit(workbook, path, content)
    write_atomically(path, content, workbook._codepuppy_edit["sourceSha256"])

def _check_text_size(workbook: Workbook, limits: Limits) -> None:
    """Refuse text that saving would write out beyond what the server can open again.

    A file stores a text once however many cells hold it, but saving writes it in every cell,
    so a copy, a fill or any edit of such a workbook can be far larger than the file. This is
    counted before anything is written.
    """
    characters = sum((len(cell.value) for sheet in workbook.worksheets for cell in held_cells(sheet).values() if isinstance(cell.value, str)))

def write_atomically(path: Path, content: bytes, source_sha256: str) -> None:
    """Write to a new temporary file next to the target, then swap it in.

    mkstemp creates the file exclusively, so a symlink planted at the temporary
    name cannot redirect the write, and a failed write leaves the target intact.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temp_name = tempfile.mkstemp(dir=path.parent, prefix='.~', suffix='.tmp')
    temp_path = Path(temp_name)
    try:
        with os.fdopen(handle, 'wb') as file:
            file.write(content)
        from codepuppy_office.excel import file_digest
        if file_digest(path) != source_sha256: raise WorkbookError("source-changed: workbook changed before atomic save")
        temp_path.replace(path)
    except OSError as error:
        raise WorkbookError(f'Could not save the workbook: {error.strerror}.') from None
    finally:
        temp_path.unlink(missing_ok=True)

def close_workbook(workbook: Workbook) -> None:
    workbook.close()
    if workbook.vba_archive:
        workbook.vba_archive.close()

def _restore_area_chart_axes(workbook: Workbook) -> None:
    """Undo an openpyxl bug that hides the axes of area charts.

    openpyxl drops the axes' ``delete`` flag when it reads an area chart, and
    Excel treats the missing flag as hidden, so without this every edit would
    remove the axes of area charts already in the workbook.
    """
    for sheet in worksheets(workbook):
        for chart in sheet._charts:
            if isinstance(chart, AreaChart):
                for axis in (chart.x_axis, chart.y_axis):
                    if axis.delete is None:
                        axis.delete = False

def _pin_hyperlinks(workbook: Workbook) -> None:
    """Point each link at the cell that holds it now.

    openpyxl keeps the address a link had when it was read, so inserting or deleting rows
    or columns would leave links on the cells that took their place.
    """
    for sheet in worksheets(workbook):
        for cell in held_cells(sheet).values():
            if cell.hyperlink:
                cell.hyperlink.ref = cell.coordinate

def get_sheet(workbook: Workbook, name: str) -> Worksheet:
    return _find_sheet(workbook, name, Worksheet)

def get_streamed_sheet(workbook: Workbook, name: str) -> ReadOnlyWorksheet:
    return _find_sheet(workbook, name, ReadOnlyWorksheet)

def worksheets(workbook: Workbook) -> list[Worksheet]:
    """The workbook's worksheets, leaving out chart sheets."""
    return [sheet for sheet in workbook.worksheets if isinstance(sheet, Worksheet)]

def streamed_worksheets(workbook: Workbook) -> list[ReadOnlyWorksheet]:
    return [sheet for sheet in workbook.worksheets if isinstance(sheet, ReadOnlyWorksheet)]

def _find_sheet(workbook: Workbook, name: str, kind: type[Sheet]) -> Sheet:
    if name not in workbook.sheetnames:
        raise SheetNotFoundError(name, workbook.sheetnames)
    sheet = workbook[name]
    if not isinstance(sheet, kind):
        available = [sheet.title for sheet in workbook.worksheets if isinstance(sheet, kind)]
        raise SheetNotFoundError(name, available)
    return sheet

def sheet_names(sheet: Worksheet) -> list[str]:
    """The names of all sheets in the workbook that holds ``sheet``."""
    return cast(Workbook, sheet.parent).sheetnames
