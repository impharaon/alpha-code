"""Fixed #1761 preparation probe. Only the fenced Location handler may invoke it.

Arguments are main-owned candidate and private task roots; no model code/URL/command.
The main-owned descriptor binds pin, original bundled control template and font profile.
"""
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys


def verify(runtime_root, job_root):
    runtime = Path(runtime_root).resolve(strict=True)
    job = Path(job_root).resolve(strict=True)
    config = json.loads((job / 'verify.json').read_text(encoding='utf-8'))
    executable = runtime / ('LibreOffice.app/Contents/MacOS/soffice' if sys.platform == 'darwin' else 'program/soffice.com')
    executable.resolve(strict=True).relative_to(runtime)
    template = Path(config['template']).resolve(strict=True)
    if hashlib.sha256(template.read_bytes()).hexdigest() != config['templateSha256']:
        raise ValueError('control template digest mismatch')
    profile = (job / 'profile').resolve(strict=True)
    if not (profile / 'user/registrymodifications.xcu').is_file():
        raise ValueError('missing private LibreOffice profile')
    environment = os.environ.copy()
    if sys.platform == 'darwin':
        fonts = (job / 'fonts.conf').resolve(strict=True)
        fonts.relative_to(job)
        environment['FONTCONFIG_FILE'] = str(fonts)
    command = [str(executable), '-env:UserInstallation=' + profile.as_uri(), '--headless', '--nologo', '--nodefault', '--nofirststartwizard', '--norestore']
    version = subprocess.run(command + ['--version'], env=environment, capture_output=True, text=True, check=True)
    if not re.match(r'^LibreOffice\s+' + re.escape(config['version']) + r'(?:\.[0-9]+)?(?:\s|$)', version.stdout):
        raise ValueError('LibreOffice version mismatch: ' + version.stdout.strip())
    output = job / 'verify-output'
    output.mkdir()  # Exclusive fresh output; never accept an earlier probe's PDF.
    source = job / 'control.docx'
    shutil.copyfile(template, source)
    converted = subprocess.run(command + ['--convert-to', 'pdf:writer_pdf_Export', '--outdir', str(output), str(source)], env=environment, capture_output=True, text=True)
    if converted.returncode:
        sys.stderr.write(converted.stderr)
        raise subprocess.CalledProcessError(converted.returncode, command)
    pdf = (output / 'control.pdf').resolve(strict=True)
    pdf.relative_to(job)
    if not pdf.stat().st_size:
        raise ValueError('empty probe PDF')
    import pypdfium2
    with pypdfium2.PdfDocument(str(pdf)) as document:
        pages = len(document)
        if pages < 1:
            raise ValueError('probe PDF has no pages')
        # Decode every page, not merely a header bearing the PDF magic.
        for page in document:
            try:
                bitmap = page.render(scale=0.25)
                try:
                    if bitmap.width < 1 or bitmap.height < 1:
                        raise ValueError('probe PDF page cannot be decoded')
                finally:
                    bitmap.close()
            finally:
                page.close()
    return {'version': config['version'], 'pdfPath': str(pdf), 'pdfSha256': hashlib.sha256(pdf.read_bytes()).hexdigest(), 'pageCount': pages}


if __name__ == '__main__':
    try:
        if len(sys.argv) != 3:
            raise ValueError('expected candidate root and private task root')
        print(json.dumps(verify(sys.argv[1], sys.argv[2]), ensure_ascii=False))
    except Exception as error:
        print(type(error).__name__ + ': ' + str(error), file=sys.stderr)
        sys.exit(1)
