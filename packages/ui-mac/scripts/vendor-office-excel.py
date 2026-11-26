"""Select the tested 2.3.2 operation closure, without its MCP/HTTP server.

Usage: python3 scripts/vendor-office-excel.py /path/to/the/pinned.whl
No package is installed and no network is used here.
"""
import ast
import hashlib
import json
from pathlib import Path
import sys
import zipfile

SHA256 = 'd0201d55d64d52a4cb1f0be25565631ab803e55dfc2eff286b1bc40a4a0e256c'
OPERATIONS = {
    'pivot_tools': ['create_pivot_table', 'delete_pivot_table'],
    'slicer_tools': ['add_slicer', 'delete_slicer'],
    'object_tools': ['add_sparklines', 'delete_sparklines'],
}
ROOTS = ['workspace', 'operations.pivot_rebuild', 'operations.sorting', 'operations.replace', 'calc.engine']
HEADER = '# Adapted for Code Puppy, 2026-11-26, from excel-mcp-server 2.3.2 (MIT).\n'


def module_path(name, names):
    base = name.replace('.', '/')
    return next((p for p in [base + '.py', base + '/__init__.py'] if p in names), None)


class Adapt(ast.NodeTransformer):
    """Remove application-excluded paths and non-format quotas, not raise their numbers."""
    def __init__(self, path):
        self.path = path

    def visit_FunctionDef(self, node):
        if self.path.endswith('workspace.py') and node.name in {'create', 'store', 'store_csv', 'read_image', 'resolve_csv_existing', 'resolve_directory', '_check_macro_target', '_check_overwrite'}:
            return None
        if self.path.endswith('text_budget.py') and node.name in {'spend', 'affords'}:
            node.body = [ast.Return(value=ast.Constant(node.name == 'affords'))]
            return node
        if self.path.endswith('text_budget.py') and node.name == '__init__':
            node.body = ast.parse('self.limit = None\nself.left = None\nself.refusal = refusal').body
            return node
        if self.path.endswith('cell_budget.py') and node.name == 'spend':
            node.body = [ast.Pass()]
            return node
        if self.path.endswith('config.py') and node.name == 'max_unpacked_bytes':
            node.body = [ast.Return(value=ast.Constant(None))]
            return node
        if self.path.endswith('refs.py') and node.name == 'within':
            node.body = [ast.Return(value=ast.Name(id='self', ctx=ast.Load()))]
            return node
        result = self.generic_visit(node)
        if not result.body: result.body = [ast.Pass()]
        return result

    def visit_AnnAssign(self, node):
        if self.path.endswith('config.py') and isinstance(node.target, ast.Name) and node.target.id.startswith('max_'):
            node.annotation = ast.parse('int | None', mode='eval').body
            node.value = ast.Constant(None)
        return self.generic_visit(node)

    def visit_AugAssign(self, node):
        if self.path.endswith('package/reader.py') and isinstance(node.target, ast.Attribute) and node.target.attr == 'budget': return None
        return self.generic_visit(node)

    def visit_ImportFrom(self, node):
        if node.module == 'excel_mcp' and self.path.endswith('workspace.py'):
            node.names = [a for a in node.names if a.name != 'macros']
        if node.module == 'excel_mcp.operations.calculated':
            node.module = 'codepuppy_office.excel'
        return node

    def visit_If(self, node):
        # Upstream's file/cell/pivot/text expansion quotas are not product requirements.
        refusal = any(isinstance(n, ast.Raise) and isinstance(n.exc, ast.Call) and isinstance(n.exc.func, ast.Name) and n.exc.func.id in {'LimitExceededError', 'too_large'} for n in node.body)
        names = {n.id for n in ast.walk(node.test) if isinstance(n, ast.Name)}
        if refusal and not names.intersection({'MAX_TEXT', 'MAX_ROW', 'MAX_COLUMN'}):
            return [self.visit(n) for n in node.orelse]
        return self.generic_visit(node)

    def visit_Call(self, node):
        self.generic_visit(node)
        if isinstance(node.func, ast.Name) and node.func.id == 'Field':
            node.keywords = [k for k in node.keywords if not (k.arg == 'max_length' and isinstance(k.value, ast.Constant) and k.value.value in {50,64,10000}) and not (k.arg == 'le' and isinstance(k.value, ast.Constant) and k.value.value in {20,100,100000})]
        return node


def selected_server(path, source):
    tree = ast.parse(source)
    register = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'register')
    chosen = [n for n in register.body if isinstance(n, ast.FunctionDef) and n.name in OPERATIONS[Path(path).stem]]
    assert len(chosen) == 2
    for n in chosen:
        n.decorator_list = []
    register.name = 'make_operations'
    register.args.args = register.args.args[1:]
    register.body = chosen + [ast.Return(value=ast.Dict(keys=[ast.Constant(n.name) for n in chosen], values=[ast.Name(id=n.name, ctx=ast.Load()) for n in chosen]))]
    used = {n.id for n in ast.walk(register) if isinstance(n, ast.Name)}
    kept = []
    for n in tree.body:
        if isinstance(n, ast.ImportFrom):
            n.names = [a for a in n.names if (a.asname or a.name) in used]
            if n.names: kept.append(n)
        elif isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in used for t in n.targets): kept.append(n)
    return ast.Module(body=kept + [register], type_ignores=[])


def main(wheel):
    assert hashlib.sha256(wheel.read_bytes()).hexdigest() == SHA256, 'wrong pinned Excel source wheel'
    output = Path(__file__).resolve().parents[1] / 'resources/office-excel'
    output.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(wheel) as archive:
        names = set(archive.namelist())
        queue = ['excel_mcp.' + n for n in ROOTS] + ['excel_mcp.server.' + n for n in OPERATIONS]
        records = []
        seen = set()
        while queue:
            name = queue.pop()
            path = module_path(name, names)
            if not path or path in seen: continue
            seen.add(path)
            source = archive.read(path)
            if path == 'excel_mcp/__init__.py':
                tree = ast.parse('__version__ = "2.3.2"')
            elif path == 'excel_mcp/server/__init__.py':
                tree = ast.parse('"""Selected callable adapters only; no server registry."""')
            elif Path(path).stem in OPERATIONS and '/server/' in path:
                tree = selected_server(path, source)
            else:
                tree = ast.parse(source)
            tree = Adapt(path).visit(tree)
            ast.fix_missing_locations(tree)
            text = ast.unparse(tree)
            if path == 'excel_mcp/workspace.py':
                text = text.replace('budget = CellBudget(self.limits.max_loaded_cells)', 'from codepuppy_office.excel import file_digest, begin_edit, prepare_save\n            original = file_digest(path)\n            budget = CellBudget(self.limits.max_loaded_cells)')
                text = text.replace('token = _edit_budget.set(budget)', 'begin_edit(workbook, path, original)\n            token = _edit_budget.set(budget)')
                text = text.replace('save_atomically(workbook, path, self.limits.max_file_bytes, lazy)', 'prepare_save(workbook)\n                save_atomically(workbook, path, self.limits.max_file_bytes, lazy)\n                self._codepuppy_result = workbook._codepuppy_edit["result"]')
                text = text.replace('write_atomically(path, content)', 'from codepuppy_office.excel import finish_edit\n    finish_edit(workbook, path, content)\n    write_atomically(path, content, workbook._codepuppy_edit["sourceSha256"])')
                text = text.replace('def write_atomically(path: Path, content: bytes)', 'def write_atomically(path: Path, content: bytes, source_sha256: str)')
                text = text.replace('temp_path.replace(path)', 'from codepuppy_office.excel import file_digest\n        if file_digest(path) != source_sha256: raise WorkbookError("source-changed: workbook changed before atomic save")\n        temp_path.replace(path)')
            if path == 'excel_mcp/package/scan.py':
                text = text.replace("prefix = next((p for p, uri in document.namespaces.items() if uri == REL_NS), None)", "scope = {**document.namespaces, **{key[6:]: value for key, value in values.items() if key.startswith('xmlns:')}}\n    prefix = next((p for p, uri in scope.items() if uri == REL_NS), None)")
            ast.parse(text)
            adapted = (HEADER + text + '\n').encode()
            target = output / path
            target.parent.mkdir(parents=True, exist_ok=True);target.write_bytes(adapted)
            records.append({'path':path,'sourceSha256':hashlib.sha256(source).hexdigest(),'sha256':hashlib.sha256(adapted).hexdigest()})
            for n in ast.walk(tree):
                if isinstance(n, ast.ImportFrom) and n.module and n.module.startswith('excel_mcp'):
                    queue.append(n.module);queue.extend(n.module + '.' + a.name for a in n.names)
                elif isinstance(n, ast.Import): queue.extend(a.name for a in n.names if a.name.startswith('excel_mcp'))
            queue.extend('.'.join(name.split('.')[:i]) for i in range(1,len(name.split('.'))))
        for path in ['excel_mcp/function_arguments.json']:
            source = archive.read(path);(output/path).write_bytes(source)
            records.append({'path':path,'sourceSha256':hashlib.sha256(source).hexdigest(),'sha256':hashlib.sha256(source).hexdigest()})
        license_path = next(p for p in names if '.dist-info/' in p and p.endswith('/LICENSE'))
        (output/'LICENSE').write_bytes(archive.read(license_path))
        (output/'sources.json').write_text(json.dumps({'version':'2.3.2','wheelSha256':SHA256,'upstream':'https://github.com/haris-musa/excel-mcp-server','adaptations':['Selected operation/schema and static dependency closure; no MCP/HTTP/CSV/VBA entrypoints','Removed non-format file/cell/text/pivot-field quotas rather than increasing caps','Current-edit formula results and save hook supplied by OfficeExcel; source-hash guard before atomic save'], 'files':sorted(records,key=lambda r:r['path'])},ensure_ascii=False,indent=2)+'\n')
        print(f'{len(records)} selected Excel Python sources')

if __name__ == '__main__': main(Path(sys.argv[1]))
