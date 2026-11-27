"""Merge computed caches into the original OOXML package, never the LO rewrite."""
from copy import deepcopy
from decimal import Decimal
import hashlib
import datetime as dt
from openpyxl.utils.datetime import to_excel
import io
from pathlib import Path
import re
import posixpath
import zipfile
from lxml import etree as ET
from openpyxl import load_workbook
from openpyxl.formula.tokenizer import Tokenizer
from openpyxl.utils.cell import range_boundaries, get_column_letter, range_to_tuple

S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
C = 'http://schemas.openxmlformats.org/drawingml/2006/chart'
NS = {'s':S,'r':R,'c':C}
PARSER = ET.XMLParser(resolve_entities=False,no_network=True)


def xml(data): return ET.fromstring(data,PARSER)
def tag(local): return '{'+S+'}'+local


def sheets(archive):
    workbook = xml(archive.read('xl/workbook.xml'))
    relationships = xml(archive.read('xl/_rels/workbook.xml.rels'))
    targets = {r.get('Id'):r.get('Target') for r in relationships}
    return {s.get('name'): posixpath.normpath(posixpath.join('xl',targets[s.get('{'+R+'}id')])).lstrip('/') for s in workbook.findall('s:sheets/s:sheet',NS)}


def expression(value):
    text = value.text if hasattr(value,'text') else value
    if not isinstance(text,str):raise ValueError('calculation incomplete: unsupported formula object')
    # LO serializes error literals in lower case; quoted string contents remain case-sensitive.
    parts=re.split(r'("(?:""|[^"])*")',text)
    text=''.join(part if index%2 else re.sub(r'#(?:REF!|DIV/0!|VALUE!|NAME\?|N/A|NUM!|NULL!|SPILL!|CALC!)',lambda match:match[0].upper(),part,flags=re.IGNORECASE) for index,part in enumerate(parts))
    tokens=Tokenizer(text if text.startswith('=') else '='+text).items
    output=[]
    for token in tokens:
        value=token.value
        if token.type=='FUNC':value=re.sub(r'^(?:_xlfn\.|_xlws\.)+','',value,flags=re.IGNORECASE).upper()
        if token.type=='OPERAND' and token.subtype=='NUMBER':value=Decimal(value)
        if token.type=='OPERAND' and token.subtype=='RANGE':value=re.sub(r"'((?:[^']|'')*)'!",lambda match:match[1].replace("''", "'")+"!",value).upper()
        output.append((token.type,token.subtype,value))
    return tuple(output)


def cached_value(cell, shared):
    kind=cell.get('t','n');value=cell.find(tag('v'))
    if kind=='inlineStr':return ('str',''.join(cell.itertext()))
    if value is None or (value.text is None and kind not in ('str','s')):raise ValueError('calculation incomplete: missing formula result at '+str(cell.get('r')))
    text=value.text or ''
    if kind=='s':return ('str',shared[int(text)])
    if kind not in ('n','b','str','e'):raise ValueError('calculation incomplete: unsupported cached type '+kind)
    return kind,text


def merge_caches(original, calculated):
    original_bytes=Path(original).read_bytes()
    workbook=load_workbook(io.BytesIO(original_bytes),data_only=False)
    computed=load_workbook(calculated,data_only=False)
    errors=[];formula_count=0
    with zipfile.ZipFile(io.BytesIO(original_bytes)) as source, zipfile.ZipFile(calculated) as result:
        original_sheets=sheets(source);result_sheets=sheets(result)
        if set(original_sheets)!=set(result_sheets):raise ValueError('calculation incomplete: worksheet identities changed')
        strings=[]
        if 'xl/sharedStrings.xml' in result.namelist():strings=[''.join(item.itertext()) for item in xml(result.read('xl/sharedStrings.xml'))]
        changes={};values={}
        for title,part in original_sheets.items():
            document=xml(source.read(part));output=xml(result.read(result_sheets[title]))
            cells={c.get('r'):c for c in document.findall('.//s:sheetData/s:row/s:c',NS)}
            calculated_cells={c.get('r'):c for c in output.findall('.//s:sheetData/s:row/s:c',NS)}
            targets=set()
            for address,cell in list(cells.items()):
                if cell.find(tag('f')) is None:continue
                formula_count+=1
                expected=workbook[title][address].value
                actual=computed[title][address].value
                if expression(expected)!=expression(actual):raise ValueError('calculation incomplete: formula mismatch at '+title+'!'+address)
                targets.add(address)
                field=cell.find(tag('f'))
                if field.get('t')=='array' and field.get('ref'):
                    left,top,right,bottom=range_boundaries(field.get('ref'))
                    targets.update(get_column_letter(c)+str(r) for r in range(top,bottom+1) for c in range(left,right+1))
            data=document.find(tag('sheetData'))
            for address in sorted(targets,key=lambda a:(workbook[title][a].row,workbook[title][a].column)):
                if address not in calculated_cells:raise ValueError('calculation incomplete: missing calculated cell '+title+'!'+address)
                kind,text=cached_value(calculated_cells[address],strings)
                cell=cells.get(address)
                if cell is None:
                    row_number=workbook[title][address].row
                    row=next((r for r in data if r.get('r')==str(row_number)),None)
                    if row is None:
                        row=ET.Element(tag('row'),r=str(row_number));data.append(row)
                        data[:]=sorted(data,key=lambda r:int(r.get('r')))
                    cell=ET.Element(tag('c'),r=address);row.append(cell)
                    row[:]=sorted(row,key=lambda c:workbook[title][c.get('r')].column)
                for old in list(cell):
                    if old.tag in (tag('v'),tag('is')):cell.remove(old)
                if kind=='n':cell.attrib.pop('t',None)
                else:cell.set('t',kind)
                value=ET.Element(tag('v'));value.text=text
                formula=cell.find(tag('f'))
                cell.insert(list(cell).index(formula)+1 if formula is not None else 0,value)
                values[(title,address)]=(kind,text)
                if kind=='e':errors.append({'sheet':title,'cell':address,'formula':getattr(workbook[title][address].value,'text',str(workbook[title][address].value)),'error':text})
            if targets:changes[part]=ET.tostring(document,encoding='utf-8',xml_declaration=True)
        # A chart's objects/relationships stay in the original part; only its data caches change.
        for part in source.namelist():
            if not part.startswith('xl/charts/') or not part.endswith('.xml') or '/_rels/' in part:continue
            chart=xml(source.read(part));changed=False
            if chart.tag!='{'+C+'}chartSpace':
                if chart.findall('.//{*}f'):raise ValueError('calculation incomplete: unrecognized chart formula/cache structure '+part)
                continue
            for reference in chart.findall('.//c:numRef',NS)+chart.findall('.//c:strRef',NS):
                f=reference.find('c:f',NS)
                if f is None or not f.text:continue
                text=f.text
                if '!' not in text:
                    name=workbook.defined_names.get(text)
                    destinations=list(name.destinations) if name else []
                    if len(destinations)!=1:raise ValueError('calculation incomplete: unresolved chart cache source '+text)
                    text=destinations[0][0]+'!'+destinations[0][1]
                title,(left,top,right,bottom)=range_to_tuple(text)
                if title not in original_sheets:raise ValueError('calculation incomplete: chart references an external sheet')
                numeric=reference.tag=='{'+C+'}numRef';cache_tag='{'+C+'}'+('numCache' if numeric else 'strCache')
                old=reference.find(cache_tag);cache=ET.Element(cache_tag)
                if old is not None:
                    fmt=old.find('{'+C+'}formatCode')
                    if fmt is not None:cache.append(deepcopy(fmt))
                ET.SubElement(cache,'{'+C+'}ptCount',val=str((bottom-top+1)*(right-left+1)))
                for index,(row,col) in enumerate(( (r,c) for r in range(top,bottom+1) for c in range(left,right+1) )):
                    address=get_column_letter(col)+str(row)
                    item=values.get((title,address))
                    value=item[1] if item else workbook[title][address].value
                    if value is None:continue
                    if numeric:
                        if isinstance(value,(dt.datetime,dt.date,dt.time,dt.timedelta)):value=to_excel(value,workbook.epoch)
                        if isinstance(value,bool):value=int(value)
                        try:float(value)
                        except (ValueError,TypeError):continue
                    point=ET.SubElement(cache,'{'+C+'}pt',idx=str(index));ET.SubElement(point,'{'+C+'}v').text=str(value)
                if old is not None:reference.remove(old)
                reference.append(cache);changed=True
            if changed:changes[part]=ET.tostring(chart,encoding='utf-8',xml_declaration=True)
        buffer=io.BytesIO()
        with zipfile.ZipFile(buffer,'w') as output:
            output.comment=source.comment
            for info in source.infolist():output.writestr(info,changes.get(info.filename,source.read(info.filename)))
    workbook.close();computed.close()
    return buffer.getvalue(),formula_count,errors
