"""The one Excel edit/save and inspection entry point for scripts and stdio."""
import base64
from contextlib import contextmanager
from copy import copy, deepcopy
import hashlib
import inspect as reflection
import json
from pathlib import Path
import sys
from typing import Annotated, Literal, Union, get_type_hints

from openpyxl import load_workbook
from openpyxl.utils.cell import range_boundaries
from pydantic import Field, TypeAdapter, ValidationError, create_model
from pydantic_core import to_jsonable_python
from excel_mcp.calc.engine import Engine
from excel_mcp.calc.values import ExcelError, UncalculableError
from excel_mcp.config import Limits
from excel_mcp.inputs import InputModel
from excel_mcp.operations import pivot_rebuild, pivot_source, sorting, replace, slicer_manage, sparklines, pivot_index
from excel_mcp.paths import PathPolicy
from excel_mcp.refs import parse_range
from excel_mcp.values import to_json
from excel_mcp.workspace import Workspace, get_sheet


def file_digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def workspace():
    # Shell/stdio retain their existing filesystem/Location authority. This is no second policy.
    return Workspace(PathPolicy([]), Limits(), False)


def formula_values(_workspace, _path, owner, area):
    workbook = owner.parent
    engine = Engine(workbook, workbook)
    engine.stale.update((sheet.title, cell.row, cell.column) for sheet in workbook.worksheets for cell in sheet._cells.values() if cell.data_type == 'f')
    return {owner.cell(row,column).coordinate: engine.calculate(owner, row, column) for row in range(area.min_row, area.max_row + 1) for column in range(area.min_col, area.max_col + 1) if owner.cell(row, column).data_type == 'f'}


def pivot_source_range(workbook, pivot):
    source = pivot.cache.cacheSource.worksheetSource
    if source is None: raise ValueError('pivot source is not a worksheet source')
    if source.name:
        for sheet in workbook.worksheets:
            if source.name in sheet.tables:
                return sheet, sheet.tables[source.name].ref
        name = workbook.defined_names.get(source.name)
        if name:
            destinations = list(name.destinations)
            if len(destinations) == 1:
                return get_sheet(workbook, destinations[0][0]), destinations[0][1]
        raise ValueError('pivot named source cannot be resolved: ' + source.name)
    return get_sheet(workbook, source.sheet), source.ref


def source_snapshot(workbook, pivot):
    sheet, reference = pivot_source_range(workbook, pivot)
    area = parse_range(reference)
    calculated = formula_values(None, None, sheet, area)
    return (sheet.title, reference, tuple((row, col, copy(sheet.cell(row,col).value), calculated.get(sheet.cell(row,col).coordinate)) for row in range(area.min_row,area.max_row+1) for col in range(area.min_col,area.max_col+1)))


def changed_cells(workbook):
    return {(sheet.title,cell.coordinate):(cell.data_type, (cell.value.text,cell.value.ref) if hasattr(cell.value,'text') else cell.value) for sheet in workbook.worksheets for cell in sheet._cells.values() if cell.value is not None}


def begin_edit(workbook, path, original):
    workbook._codepuppy_edit = {'path':str(path), 'sourceSha256':original, 'diagnostics':[], 'pivots':{}, 'cells':changed_cells(workbook)}
    for sheet in workbook.worksheets:
        for pivot in sheet._pivots:
            try: snapshot = source_snapshot(workbook, pivot)
            except Exception as error: snapshot = error
            workbook._codepuppy_edit['pivots'][(sheet.title,pivot.name)] = snapshot


def prepare_save(workbook):
    state = workbook._codepuppy_edit
    for sheet in workbook.worksheets:
        for pivot in list(sheet._pivots):
            old = state['pivots'].get((sheet.title,pivot.name))
            if old is None: continue  # A newly created pivot already consumed this edit's values.
            source = str(getattr(pivot.cache.cacheSource, 'worksheetSource', ''))
            try:
                current = source_snapshot(workbook,pivot)
                if not isinstance(old,Exception) and current == old: continue
                if not pivot_rebuild.can_rebuild(pivot): raise ValueError('pivot was created or refreshed by Excel; retained without rebuilding')
                owner, reference = pivot_source_range(workbook,pivot)
                pivot_source.read_source(owner,reference,None,lambda owner,area:formula_values(None,None,owner,area))
                # Rebuild mutates the sheet in place. Preserve its prior object/cells on any failure.
                pivots = list(sheet._pivots)
                cells = {key:copy(value) for key,value in sheet._cells.items()}
                try: pivot_rebuild.rebuild(workbook,sheet,pivot,lambda request:request,Limits(),lambda owner,area:formula_values(None,None,owner,area))
                except Exception:
                    sheet._pivots[:] = pivots;sheet._cells.clear();sheet._cells.update(cells)
                    raise
            except Exception as error:
                state['diagnostics'].append({'kind':'pivot-not-rebuilt','sheet':sheet.title,'pivot':pivot.name,'source':source,'detail':str(error)})


def finish_edit(workbook, path, content):
    state = workbook._codepuppy_edit
    if file_digest(path) != state['sourceSha256']: raise ValueError('source-changed: workbook changed during edit')
    current=changed_cells(workbook)
    ranges=[{'sheet':key[0],'range':key[1]} for key in sorted(set(current)|set(state['cells'])) if current.get(key)!=state['cells'].get(key)]
    state['result'] = {'ranges':ranges,'path':str(path),'sourceSha256':state['sourceSha256'],'resultSha256':hashlib.sha256(content).hexdigest(),'diagnostics':state['diagnostics']}


@contextmanager
def edit(path):
    with workspace().edit(path) as workbook: yield workbook
    print(json.dumps(workbook._codepuppy_edit['result'],ensure_ascii=False),file=sys.stderr)


class WorkbookInspect(InputModel):
    path: str
    action: Literal['workbook']
class SheetInspect(InputModel):
    path: str
    action: Literal['sheet']
    sheet: str
class RangeInspect(InputModel):
    path: str
    action: Literal['range']
    sheet: str
    range: str | None = None
    mode: Literal['values','formulas','both'] = 'values'
    rows: int | None = Field(default=None,gt=0)
    cursor: str | None = None
class FindInspect(InputModel):
    path: str
    action: Literal['find']
    query: str
    sheet: str | None = None
    exact: bool = False
    caseSensitive: bool = False
    mode: Literal['values','formulas'] = 'values'
    cursor: str | None = None
class SortEdit(InputModel):
    path: str
    action: Literal['sort']
    sheet: str
    range: str
    sortBy: list[sorting.SortKey] = Field(min_length=1)
    hasHeader: bool = True
class ReplaceEdit(InputModel):
    path: str
    action: Literal['replace']
    query: str
    replacement: str
    sheet: str | None = None
    exact: bool = False
    caseSensitive: bool = False
    inFormulas: bool = False
INSPECT = TypeAdapter(Annotated[Union[WorkbookInspect,SheetInspect,RangeInspect,FindInspect],Field(discriminator='action')])
EDIT = TypeAdapter(Annotated[Union[SortEdit,ReplaceEdit],Field(discriminator='action')])


def describe_sheet(workbook,sheet):
    return {'name':sheet.title,'usedRange':sheet.calculate_dimension(),'tables':[{'name':t.name,'range':t.ref} for t in sheet.tables.values()], 'charts':[{'name':getattr(c,'name',None),'type':type(c).__name__} for c in sheet._charts], 'pivots':[p.model_dump() for p in pivot_index.list_pivots(sheet)],'slicers':[s.model_dump() for s in slicer_manage.list_slicers(workbook,sheet)],'sparklines':[s.model_dump() for s in sparklines.list_sparklines(sheet)]}


def inspect(input_json):
    try: request = INSPECT.validate_json(input_json)
    except ValidationError as error: raise ValueError('invalid-input: '+str(error)) from error
    source = file_digest(request.path)
    values = load_workbook(request.path,data_only=True)
    try:
        with workspace().read(request.path) as workbook:
            if request.action == 'workbook':
                return {'sheets':[describe_sheet(workbook,s) for s in workbook.worksheets], 'definedNames':[{'name':n.name,'value':n.attr_text} for n in workbook.defined_names.values()],'sourceSha256':source}
            if request.action == 'sheet': return {**describe_sheet(workbook,get_sheet(workbook,request.sheet)),'sourceSha256':source}
            engine = Engine(values,workbook)
            sheets = [get_sheet(workbook,request.sheet)] if request.sheet else workbook.worksheets
            binding = request.model_dump(exclude={'cursor','rows'}) | {'sourceSha256':source}
            fingerprint = hashlib.sha256(json.dumps(binding,sort_keys=True).encode()).hexdigest()
            offset = 0
            if request.cursor:
                cursor=json.loads(base64.urlsafe_b64decode(request.cursor))
                if cursor.get('sourceSha256') != source: raise ValueError('source-changed: read cursor belongs to a different workbook version')
                if cursor.get('binding') != fingerprint or not isinstance(cursor.get('offset'),int) or cursor['offset'] < 0: raise ValueError('invalid-input: cursor binding mismatch')
                offset=cursor['offset']
            output=[];errors=[];reasons=[];used=0;next_offset=None;index=0
            # Output budget is pagination, not a file/range limit; explicit rows are unbounded.
            budget=32000
            for sheet in sheets:
                reference=getattr(request,'range',None) or sheet.calculate_dimension();area=parse_range(reference)
                for row in range(area.min_row,area.max_row+1):
                    for column in range(area.min_col,area.max_col+1):
                        cell=sheet.cell(row,column)
                        if index < offset: index+=1;continue
                        formula=cell.value if cell.data_type=='f' else None
                        value=values[sheet.title].cell(row,column).value if formula else cell.value
                        origin='stored' if formula and value is not None else 'literal' if not formula else 'missing'
                        if formula and value is None:
                            try:
                                value=engine.calculate(sheet,row,column);origin='community-evaluator'
                            except UncalculableError as error: reasons.append({'sheet':sheet.title,'cell':cell.coordinate,'reason':str(error)});value=None
                        if isinstance(value,ExcelError): value=value.code
                        record={'address':cell.coordinate,'value':to_json(value),'valueSource':origin}
                        if formula and request.mode in ('formulas','both'): record['formula']=formula
                        if formula and (isinstance(value,str) and value.startswith('#') and value in {'#REF!','#DIV/0!','#VALUE!','#NAME?','#N/A','#NUM!','#NULL!','#SPILL!','#CALC!'}): errors.append({'sheet':sheet.title,'cell':cell.coordinate,'formula':str(formula),'error':value})
                        if request.action == 'find':
                            text=str(formula or '') if request.mode=='formulas' else str(record['value'] if record['value'] is not None else '')
                            query=request.query
                            if not request.caseSensitive: text=text.casefold();query=query.casefold()
                            if not (text==query if request.exact else query in text): index+=1;continue
                            record['sheet']=sheet.title
                        cost=len(json.dumps(record,ensure_ascii=False))
                        row_limit=getattr(request,'rows',None)
                        if output and ((row_limit is None and used+cost>budget) or (row_limit is not None and row>=area.min_row+(offset//area.cols)+row_limit)):
                            next_offset=index;break
                        output.append(record);used+=cost;index+=1
                    if next_offset is not None:break
                if next_offset is not None:break
            cursor=base64.urlsafe_b64encode(json.dumps({'binding':fingerprint,'offset':next_offset,'sourceSha256':source}).encode()).decode() if next_offset is not None else None
            if file_digest(request.path)!=source:raise ValueError('source-changed: workbook changed during read')
            return {'sheet':request.sheet if request.sheet else None,'range':getattr(request,'range',None) or (sheets[0].calculate_dimension() if len(sheets)==1 else None),'cells':output,'errors':errors,'uncalculated':reasons,'nextCursor':cursor,'sourceSha256':source}
    finally: values.close()


def apply_edit(input_json):
    try: request=EDIT.validate_json(input_json)
    except ValidationError as error: raise ValueError('invalid-input: '+str(error)) from error
    with workspace().edit(request.path) as workbook:
        if request.action=='sort':
            changed=sorting.sort_range(get_sheet(workbook,request.sheet),request.range,request.sortBy,request.hasHeader,None)
        else:
            changed=replace.replace_cells([get_sheet(workbook,request.sheet)] if request.sheet else workbook.worksheets,request.query,request.replacement,exact=request.exact,case_sensitive=request.caseSensitive,in_formulas=request.inFormulas,limits=Limits()).replaced
    return {**workbook._codepuppy_edit['result'],'changed':changed}


def operation_models(workspace_value):
    from excel_mcp.server import pivot_tools,slicer_tools,object_tools
    functions={**pivot_tools.make_operations(workspace_value),**slicer_tools.make_operations(workspace_value),**object_tools.make_operations(workspace_value)}
    return {name:(function,create_model(name,__base__=InputModel,**{key:(get_type_hints(function,include_extras=True)[key],parameter.default if parameter.default is not reflection.Parameter.empty else ...) for key,parameter in reflection.signature(function).parameters.items() if key!='path'})) for name,function in functions.items()}


def object_schema(operation):
    if not isinstance(operation,str):raise ValueError("invalid-input: Excel operation must be a string")
    model=operation_models(workspace()).get(operation)
    if model is None:raise ValueError('invalid-input: unknown Excel object operation')
    schema=model[1].model_json_schema()
    return {'operation':operation,'inputSchema':schema,'defaults':to_jsonable_python({name:field.get_default(call_default_factory=True) for name,field in model[1].model_fields.items() if not field.is_required()})}


def objects(path,operation,input_json):
    if not isinstance(operation,str):raise ValueError("invalid-input: Excel operation must be a string")
    current=workspace();entry=operation_models(current).get(operation)
    if entry is None:raise ValueError('invalid-input: unknown Excel object operation')
    try: arguments=entry[1].model_validate_json(input_json)
    except ValidationError as error: raise ValueError('invalid-input: '+str(error)) from error
    # Preserve nested InputModel objects; model_dump would erase the operation's types.
    changed=entry[0](path=path,**{name:getattr(arguments,name) for name in entry[1].model_fields})
    if operation=='add_slicer' and changed.note:
        with current.read(path) as workbook:
            target=arguments.target
            pivot=next((p for p in get_sheet(workbook,target.sheet)._pivots if p.name==target.name),None)
            source=str(pivot.cache.cacheSource.worksheetSource) if pivot else target.name
        current._codepuppy_result['diagnostics'].append({'kind':'pivot-not-rebuilt','sheet':target.sheet,'pivot':target.name,'source':source,'detail':changed.note})
    return current._codepuppy_result


def recalculate(path):
    from .recalculate import recalculate
    return recalculate(path)
