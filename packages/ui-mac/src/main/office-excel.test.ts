// Integration: actual -I Office Python, app modules and OOXML. LO journeys are one-time acceptance.
import { beforeAll, describe, expect, test } from "bun:test"
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
  test("missing runtime projection fails recalculation without preventing normal edits", () => run(`
import os
os.environ.pop('CODEPUPPY_DOCUMENT_HOST',None)
assert OfficeExcel.recalculate(str(path))['code']=='runtime'
with OfficeExcel.edit(str(path)) as w:w['Data']['B2']=55
assert load_workbook(path)['Data']['B2'].value==55
`))
})
