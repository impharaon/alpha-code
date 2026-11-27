"""Fixed Office/PDF renderer. Receives a Location-owned job descriptor, never code."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile
import xml.etree.ElementTree as ET
import pypdfium2


class RenderFailure(Exception):
    def __init__(self, code, detail):
        self.code = code
        super().__init__(detail)


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def render(job):
    root = Path(job).resolve(strict=True)
    config = json.loads((root / 'render.json').read_text(encoding='utf-8'))
    source = Path(config['source']).resolve(strict=True)
    kind = config['kind']
    if digest(source) != config['sourceSha256']:
        raise RenderFailure('source-changed', 'source changed before snapshot')
    snapshot = root / ('source.' + kind)
    shutil.copyfile(source, snapshot)
    template_source = None
    diagnostics = []
    if kind in ('docx', 'xlsx', 'pptx'):
        part = {'docx': 'word/document.xml', 'xlsx': 'xl/workbook.xml', 'pptx': 'ppt/presentation.xml'}[kind]
        with zipfile.ZipFile(snapshot) as archive:
            if part not in archive.namelist() or '[Content_Types].xml' not in archive.namelist():
                raise RenderFailure('invalid-input', 'requested kind does not match the Office container')
            if kind == 'docx':
                document_xml = ET.fromstring(archive.read(part))
                w = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
                if any('TOC' in field.get(w + 'instr', '') and not any(node.text for node in field.iter(w + 't')) for field in document_xml.iter(w + 'fldSimple')):
                    diagnostics.append('source Word TOC cache is empty; renderer updates only its snapshot')
                fields = []
                for node in document_xml.iter():
                    if node.tag == w + 'fldChar':
                        field_type = node.get(w + 'fldCharType')
                        if field_type == 'begin':
                            fields.append({'instruction': '', 'text': '', 'result': False})
                        elif fields and field_type == 'separate':
                            fields[-1]['result'] = True
                        elif fields and field_type == 'end':
                            field = fields.pop()
                            if 'PAGEREF' in field['instruction'] and not field['text'].strip():
                                diagnostics.append('source Word PAGEREF cache is empty; renderer updates only its snapshot')
                    elif fields and node.tag == w + 'instrText':
                        fields[-1]['instruction'] += node.text or ''
                    elif fields and fields[-1]['result'] and node.tag == w + 't':
                        fields[-1]['text'] += node.text or ''
            if 'docProps/custom.xml' in archive.namelist():
                for prop in ET.fromstring(archive.read('docProps/custom.xml')):
                    if prop.get('name') == 'CodePuppyTemplateSource' and len(prop):
                        template_source = prop[0].text
        output = root / 'pdf'
        output.mkdir()
        profile = Path(config['profileRoot']).resolve(strict=True)
        environment = os.environ.copy()
        if sys.platform == 'darwin':
            fontconfig = (profile / 'fonts.conf').resolve(strict=True)
            environment['FONTCONFIG_FILE'] = str(fontconfig)
        user_profile = (profile / 'profile').resolve(strict=True)
        filter_name = {'docx': 'writer_pdf_Export', 'xlsx': 'calc_pdf_Export', 'pptx': 'impress_pdf_Export'}[kind]
        command = [config['executable'], '-env:UserInstallation=' + user_profile.as_uri(), '--headless', '--nologo', '--nodefault', '--norestore', '--nofirststartwizard']
        if kind == 'docx':
            initialized = subprocess.run(command + ['--terminate_after_init'], env=environment, capture_output=True, text=True, encoding='utf-8', errors='replace')
            if initialized.returncode:
                raise RenderFailure('conversion', initialized.stderr)
            # LibreOffice itself creates the native Standard/Module1 catalogue. Only our fixed module replaces it.
            module = user_profile / 'user/basic/Standard/Module1.xba'
            if not module.is_file():
                raise RenderFailure('conversion', 'LibreOffice did not create its private Basic catalogue')
            shutil.copyfile(Path(__file__).parent / 'update_fields.xba', module)
            updated = subprocess.run(command + ['vnd.sun.star.script:Standard.Module1.UpdateFieldsAndSave?language=Basic&location=application', str(snapshot)], env=environment, capture_output=True, text=True, encoding='utf-8', errors='replace')
            if updated.returncode:
                raise RenderFailure('conversion', 'Writer field update failed: ' + updated.stderr)
        command += ['--convert-to', 'pdf:' + filter_name, '--outdir', str(output), str(snapshot)]
        result = subprocess.run(command, env=environment, capture_output=True, text=True, encoding='utf-8', errors='replace')
        if result.stderr:
            sys.stderr.write(result.stderr)
        if result.returncode:
            raise RenderFailure('conversion', 'LibreOffice exit ' + str(result.returncode) + ': ' + result.stderr)
        pdf = output / ('source.pdf')
        if not pdf.is_file() or not pdf.stat().st_size:
            raise RenderFailure('conversion', 'LibreOffice did not create a fresh nonempty PDF')
    elif kind == 'pdf':
        pdf = snapshot
    else:
        raise RenderFailure('invalid-input', 'fixed renderer only accepts Office/PDF')
    pages_root = root / 'pages'
    pages_root.mkdir()
    pages = []
    try:
        with pypdfium2.PdfDocument(str(pdf)) as document:
            if len(document) == 0:
                raise RenderFailure('raster', 'PDF has no pages')
            for number in range(len(document)):
                page = document[number]
                try:
                    bitmap = page.render(scale=config.get('dpi', 144) / 72)
                    try:
                        path = pages_root / (str(number + 1) + '.png')
                        image = bitmap.to_pil()
                        try:
                            image.save(path, format='PNG')
                        finally:
                            image.close()
                        pages.append({'number': number + 1, 'path': str(path), 'sha256': digest(path), 'width': bitmap.width, 'height': bitmap.height})
                    finally:
                        bitmap.close()
                finally:
                    page.close()
    except RenderFailure:
        raise
    except Exception as error:
        raise RenderFailure('raster', str(error)) from error
    if digest(source) != config['sourceSha256']:
        raise RenderFailure('source-changed', 'source changed during rendering; original file retained')
    return {'status': 'rendered', 'renderer': 'pdfium' if kind == 'pdf' else 'libreoffice-pdfium', 'rendererVersion': (config.get('version', '') + '; ' if kind != 'pdf' else '') + 'PDFium ' + str(pypdfium2.PDFIUM_INFO) + '; pypdfium2 ' + str(pypdfium2.PYPDFIUM_INFO), 'pages': pages, 'pageCount': len(pages), 'templateSource': template_source, 'diagnostics': diagnostics}


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
    try:
        if len(sys.argv) != 2:
            raise RenderFailure('invalid-input', 'expected fixed job root')
        print(json.dumps(render(sys.argv[1]), ensure_ascii=False))
    except Exception as error:
        code = error.code if isinstance(error, RenderFailure) else 'disk' if isinstance(error, OSError) else 'conversion'
        print(json.dumps({'status': 'failed', 'code': code, 'detail': str(error)}, ensure_ascii=False))
