// Integration: actual -I Office Python, app modules and OOXML. LO journeys are one-time acceptance.
import { beforeAll, describe, expect, test } from "bun:test"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { installOfficeExcel, officeRuntimeDir } from "../../scripts/build-office-runtime"
import { officePythonPath } from "../shared/document-resources"
const runtime = officeRuntimeDir(process.arch === "arm64" ? "arm64" : "x64")
beforeAll(() => installOfficeExcel(runtime))
function run(body: string) {
  const result = spawnSync(officePythonPath(runtime, process.platform), ["-I", "-B", "-c", `
import json,tempfile,zipfile
from pathlib import Path
from openpyxl import Workbook,load_workbook
from codepuppy_office import OfficeExcel
with tempfile.TemporaryDirectory() as directory:
 path=Path(directory)/'sample.xlsx'
 workbook=Workbook();workbook.active.title='Data'
 workbook.active.append(['Region','Amount']);workbook.active.append(['East',12]);workbook.active.append(['West',4])
 workbook.create_sheet('Summary');workbook.save(path)
${body.split("\n").map((line) => " " + line).join("\n")}
`], { encoding: "utf8" })
  expect(result.status, result.stderr).toBe(0)
}
describe("OfficeExcel", () => {
  test("isolated reads calculate values, mark unsupported formulas missing and locate reference errors", () => run(`
with OfficeExcel.edit(str(path)) as w:
 w['Data']['C2']='=B2*2';w['Data']['D2']='=#REF!';w['Data']['E2']='=UNSUPPORTED(B2)'
value=OfficeExcel.inspect(json.dumps({'action':'range','path':str(path),'sheet':'Data','mode':'both'}))
cells={c['address']:c for c in value['cells']}
assert cells['C2']['value']==24 and cells['C2']['valueSource']=='community-evaluator'
assert cells['E2']['value'] is None and cells['E2']['valueSource']=='missing'
assert value['errors']==[{'sheet':'Data','cell':'D2','formula':'=#REF!','error':'#REF!'}]
assert value['uncalculated'][0]['cell']=='E2'
`))
  test("sort and literal replacement use the shared save path", () => run(`
OfficeExcel.apply_edit(json.dumps({'path':str(path),'action':'sort','sheet':'Data','range':'A1:B3','sortBy':[{'column':'Amount'}]}))
assert load_workbook(path)['Data']['A2'].value=='West'
with OfficeExcel.edit(str(path)) as w:w['Data']['A2']='a.b'
OfficeExcel.apply_edit(json.dumps({'path':str(path),'action':'replace','query':'.','replacement':'-'}))
assert load_workbook(path)['Data']['A2'].value=='a-b'
`))
  test("object schemas preserve required upstream types/defaults and reject unknown fields", () => run(`
schema=OfficeExcel.object_schema('create_pivot_table')
assert schema['inputSchema']['required']==['sheet','at','source','row_fields','value_fields']
assert 'maxItems' not in schema['inputSchema']['properties']['row_fields']
assert 'target' in OfficeExcel.object_schema('add_slicer')['inputSchema']['properties']
try:OfficeExcel.objects(str(path),'delete_pivot_table',json.dumps({'sheet':'Summary','name':'x','unknown':1}))
except Exception as e:assert 'unknown' in str(e)
else:raise AssertionError('unknown field accepted')
`))
  test("saving edited pivot sources rebuilds from current formulas and retains slicers/sparklines", () => run(`
with OfficeExcel.edit(str(path)) as w:w['Data']['B2']='=10+2'
OfficeExcel.objects(str(path),'create_pivot_table',json.dumps({'sheet':'Summary','at':'A1','source':'Data!A1:B3','row_fields':['Region'],'value_fields':[{'field':'Amount'}]}))
OfficeExcel.objects(str(path),'add_slicer',json.dumps({'sheet':'Summary','target':{'sheet':'Summary','name':'PivotTable1'},'field':'Region','at':'E2'}))
OfficeExcel.objects(str(path),'add_sparklines',json.dumps({'sheet':'Data','range':'D2:D3','source':'Data!B2:C3'}))
with OfficeExcel.edit(str(path)) as w:w['Data']['B2']='=20+2'
assert load_workbook(path)['Summary']['B2'].value==22
with zipfile.ZipFile(path) as archive:
 assert any('slicer' in name.lower() for name in archive.namelist())
 assert b'sparkline' in archive.read('xl/worksheets/sheet1.xml')
`))
  test("a non-rebuildable pivot is retained with diagnostics while the source edit is saved", () => run(`
OfficeExcel.objects(str(path),'create_pivot_table',json.dumps({'sheet':'Summary','at':'A1','source':'Data!A1:B3','row_fields':['Region'],'value_fields':[{'field':'Amount'}]}))
# Controlled can_rebuild=false boundary on a real generated pivot, not an Excel-authored fixture claim.
with OfficeExcel.edit(str(path)) as w:w['Summary']._pivots[0].cache.refreshedBy='Excel'
result=OfficeExcel.apply_edit(json.dumps({'path':str(path),'action':'replace','query':'East','replacement':'North'}))
assert result['diagnostics'][0]['kind']=='pivot-not-rebuilt'
assert result['diagnostics'][0]['sheet']=='Summary' and result['diagnostics'][0]['pivot']=='PivotTable1'
actual=load_workbook(path)
assert actual['Data']['A2'].value=='North' and len(actual['Summary']._pivots)==1
`))

  test("source changes are not overwritten and read cursors bind their workbook version", () => run(`
try:
 with OfficeExcel.edit(str(path)) as w:
  w['Data']['B2']=90
  other=load_workbook(path);other['Data']['B2']=88;other.save(path)
except Exception as error:assert 'source-changed' in str(error)
else:raise AssertionError('concurrent edit overwritten')
assert load_workbook(path)['Data']['B2'].value==88
first=OfficeExcel.inspect(json.dumps({'action':'range','path':str(path),'sheet':'Data','rows':1}))
assert first['nextCursor']
with OfficeExcel.edit(str(path)) as w:w['Data']['B2']=77
try:OfficeExcel.inspect(json.dumps({'action':'range','path':str(path),'sheet':'Data','cursor':first['nextCursor']}))
except Exception as error:assert 'source-changed' in str(error)
else:raise AssertionError('old cursor accepted')
`))
  test("Python consumes live projection changes, rejects regression and in-flight pin/configuration changes", () => run(`
import os
from codepuppy_office.recalculate import read_projection
host=Path(directory)/'host.json'
value={'schemaVersion':1,'sequence':0,'sidecarGeneration':8,'registrationId':'registration','location':{'directory':directory},'status':'active','pinId':'libreoffice/darwin-arm64/test','pinSha256':'a'*64,'runtime':{'phase':'preparing','stage':'download'},'jobs':{'root':directory,'profileSeed':directory,'fontconfigTemplate':None,'configurationSha256':'b'*64,'timeoutMs':180000}}
host.write_text(json.dumps(value));os.environ['CODEPUPPY_DOCUMENT_HOST']=str(host)
assert OfficeExcel.recalculate(str(path))['status']=='pending'
value['runtime']={'phase':'ready','executable':__import__('sys').executable,'version':'test'};host.write_text(json.dumps(value))
_,binding=read_projection()
value['sequence']=1;value['pinSha256']='c'*64;host.write_text(json.dumps(value))
try:read_projection(binding)
except RuntimeError as error:assert 'pin/configuration' in str(error)
else:raise AssertionError('in-flight pin change accepted')
value['sequence']=0;host.write_text(json.dumps(value))
assert OfficeExcel.recalculate(str(path))['code']=='runtime'
value={key:value[key] for key in ['schemaVersion','sequence','sidecarGeneration','registrationId','location']}
value.update(sequence=2,status='invalidated',reason='location-disposed');host.write_text(json.dumps(value))
assert OfficeExcel.recalculate(str(path))['code']=='runtime'
host.write_text('{')
assert OfficeExcel.recalculate(str(path))['code']=='runtime'
`))

  test("real LibreOffice caches merge into the original package without changing formulas or extension parts", () => run(`
import hashlib
from codepuppy_office.cache import merge_caches
original=Path(${JSON.stringify(join(import.meta.dir, "fixtures/office-excel/cache-original.xlsx"))})
calculated=Path(${JSON.stringify(join(import.meta.dir, "fixtures/office-excel/cache-calculated.xlsx"))})
content,count,errors=merge_caches(original,calculated)
path.write_bytes(content)
actual=load_workbook(path,data_only=True)
assert count==4 and actual['Summary']['H2'].value==20100
assert actual['Summary']['I2'].value=='中文' and actual['Summary']['J2'].value is True
# The fixture records pinned LibreOffice's computed value for an imported =#REF! literal.
assert errors==[{'sheet':'Summary','cell':'K2','formula':'=#REF!','error':'#NAME?'}]
assert load_workbook(path)['Summary']['K2'].value=='=#REF!'
with zipfile.ZipFile(original) as before,zipfile.ZipFile(path) as after:
 for name in before.namelist():
  if name.startswith('xl/worksheets/sheet') or name.startswith('xl/charts/chart'):continue
  assert before.read(name)==after.read(name),name
 assert b'20100' in after.read('xl/charts/chart1.xml')
`))

  test("missing runtime projection fails recalculation without preventing normal edits", () => run(`
import os
os.environ.pop('CODEPUPPY_DOCUMENT_HOST',None)
assert OfficeExcel.recalculate(str(path))['code']=='runtime'
with OfficeExcel.edit(str(path)) as w:w['Data']['B2']=55
assert load_workbook(path)['Data']['B2'].value==55
`))
})

for (const [name, source, calculated] of [
  ["decimal", "=0.10+A1", "=0.1+A1"],
  ["function case", "=sum(A1)", "=SUM(A1)"],
  ["reference case and sheet quotes", "='Sales'!$a$1", "=Sales!$A$1"],
] as const) test(`formula tokens normalize ${name} as observed in the pinned LO save`, () => run(`
from codepuppy_office.cache import expression
assert expression(${JSON.stringify(source)}) == expression(${JSON.stringify(calculated)})
assert expression('="MiXeD"') != expression('="mixed"')
assert expression('=A1+1') != expression('=A1+2')
`))
