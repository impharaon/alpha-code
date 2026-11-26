"""Fixed LO calculation with a live, main-owned registration projection."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import uuid
from xml.sax.saxutils import escape

from .cache import merge_caches
from .excel import file_digest

_identity = None
_sequence = -1


def _read_projection(expected=None):
    global _identity,_sequence
    path=os.environ.get('CODEPUPPY_DOCUMENT_HOST')
    if not path or not Path(path).is_absolute():raise RuntimeError('missing absolute CODEPUPPY_DOCUMENT_HOST projection')
    value=json.loads(Path(path).read_text(encoding='utf-8'))
    base={'schemaVersion','sequence','sidecarGeneration','registrationId','location','status'}
    active=base|{'pinId','pinSha256','runtime','jobs'}
    if not isinstance(value,dict) or set(value)!=(active if value.get('status')=='active' else base|{'reason'}):raise RuntimeError('invalid document host schema')
    if value['schemaVersion']!=1 or any(isinstance(value.get(k),bool) or not isinstance(value.get(k),int) or not 0<=value[k]<=9007199254740991 for k in ['sequence','sidecarGeneration']):raise RuntimeError('invalid document host sequence/generation')
    location=value['location']
    if not isinstance(location,dict) or set(location)-{'directory','workspaceID'} or not isinstance(location.get('directory'),str) or not Path(location['directory']).is_absolute() or not isinstance(value['registrationId'],str) or not value['registrationId']:raise RuntimeError('invalid document host Location/registration')
    identity=(str(Path(path).resolve(strict=True)),value['sidecarGeneration'],value['registrationId'],json.dumps(location,sort_keys=True))
    if _identity is None:_identity=identity
    if identity!=_identity or value['sequence']<_sequence:raise RuntimeError('document host identity changed or sequence regressed')
    _sequence=value['sequence']
    if value['status']!='active':raise RuntimeError('document host invalidated: '+str(value.get('reason')))
    if not isinstance(value['pinId'],str) or not re.fullmatch(r'libreoffice/(darwin-arm64|win32-x64)/[^/]+',value['pinId']) or not re.fullmatch('[a-f0-9]{64}',str(value['pinSha256'])):raise RuntimeError('invalid document host pin')
    jobs=value['jobs'];runtime=value['runtime']
    if not isinstance(jobs,dict) or set(jobs)!={'root','profileSeed','fontconfigTemplate','configurationSha256','timeoutMs'} or jobs['timeoutMs']!=180000 or not re.fullmatch('[a-f0-9]{64}',str(jobs['configurationSha256'])):raise RuntimeError('invalid document job configuration')
    for key in ['root','profileSeed']:
        if not isinstance(jobs[key],str) or not Path(jobs[key]).is_absolute():raise RuntimeError('invalid document job path')
    if jobs['fontconfigTemplate'] is not None and (not isinstance(jobs['fontconfigTemplate'],str) or not Path(jobs['fontconfigTemplate']).is_absolute()):raise RuntimeError('invalid fontconfig template')
    if not isinstance(runtime,dict) or runtime.get('phase') not in {'ready','preparing','failed'}:raise RuntimeError('invalid document runtime state')
    if runtime['phase']=='ready' and (not isinstance(runtime.get('executable'),str) or not Path(runtime['executable']).is_absolute() or not isinstance(runtime.get('version'),str)):raise RuntimeError('invalid verified LO entry')
    if runtime['phase']=='preparing' and runtime.get('stage') not in {'download','extract','verify'}:raise RuntimeError('invalid preparing stage')
    if runtime['phase']=='failed' and not isinstance(runtime.get('failure'),dict):raise RuntimeError('invalid runtime failure')
    binding=(value['pinId'],value['pinSha256'],jobs['configurationSha256'])
    if expected is not None and binding!=expected:raise RuntimeError('document LO pin/configuration changed during calculation')
    if expected is not None and runtime['phase']!='ready':raise RuntimeError('verified document runtime is no longer ready')
    return value,binding


def read_projection(expected=None):
    try: return _read_projection(expected)
    except (KeyError, TypeError, ValueError, OSError) as error: raise RuntimeError('invalid document host projection: '+str(error)) from error


def run(command,environment,binding,deadline):
    process=subprocess.Popen(command,env=environment,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    try:
        while True:
            read_projection(binding)
            remaining=deadline-time.monotonic()
            if remaining<=2:raise TimeoutError('calculation timeout (180000ms)')
            try:
                stdout,stderr=process.communicate(timeout=min(.1,remaining-2))
                if process.returncode:raise ValueError('LibreOffice exit '+str(process.returncode)+': '+stderr.decode('utf-8','replace'))
                return stdout,stderr
            except subprocess.TimeoutExpired:pass
    except BaseException:
        if sys.platform=='win32':subprocess.run(['taskkill','/PID',str(process.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        else:
            process.terminate()
            try:process.wait(timeout=2)
            except subprocess.TimeoutExpired:process.kill()
        process.communicate()
        raise


def recalculate(path):
    try:
        source=Path(path).resolve(strict=True);source_hash=file_digest(source)
        projection,binding=read_projection()
        state=projection['runtime']
        if state['phase']=='preparing':return {'status':'pending','checkId':str(uuid.uuid4()),'runtime':state}
        if state['phase']=='failed':raise RuntimeError(json.dumps(state['failure'],ensure_ascii=False))
        jobs=projection['jobs']
        root=Path(jobs['root']).resolve(strict=True)
        identifier=str(uuid.uuid4())
        job=root/('recalculate-'+identifier);job.mkdir()
        profile=job/'profile';shutil.copytree(Path(jobs['profileSeed']).resolve(strict=True),profile)
        snapshot=job/'source.xlsx';shutil.copyfile(source,snapshot)
        environment=os.environ.copy()
        if sys.platform=='darwin':
            template=Path(jobs['fontconfigTemplate']).read_text(encoding='utf-8')
            if '{{JOB_FONT_CACHE}}' not in template:raise RuntimeError('fontconfig template has no job cache marker')
            cache=job/'font-cache';cache.mkdir()
            config=job/'fonts.conf';config.write_text(template.replace('{{JOB_FONT_CACHE}}',escape(str(cache),{'"':'&quot;'})),encoding='utf-8')
            environment['FONTCONFIG_FILE']=str(config)
        else:
            environment.pop('FONTCONFIG_FILE',None)
            if jobs['fontconfigTemplate'] is not None:raise RuntimeError('Windows document host must not provide fontconfig')
        command=[state['executable'],'-env:UserInstallation='+profile.as_uri(),'--headless','--nologo','--nodefault','--norestore','--nofirststartwizard','vnd.sun.star.script:Standard.Module1.RecalculateAndSave?language=Basic&location=application',str(snapshot)]
        deadline=time.monotonic()+jobs['timeoutMs']/1000
        run(command[:-2]+['--terminate_after_init'],environment,binding,deadline)
        # LO creates/overwrites its Basic catalogue on first use; restore only our fixed module afterwards.
        module=profile/'user/basic/Standard/Module1.xba'
        if not module.is_file():raise RuntimeError('LibreOffice did not initialize its private Basic catalogue')
        shutil.copyfile(Path(jobs['profileSeed'])/'user/basic/Standard/Module1.xba',module)
        run(command,environment,binding,deadline)
        read_projection(binding)
        content,count,errors=merge_caches(source,snapshot)
        if file_digest(source)!=source_hash:return {'status':'failed','code':'source-changed','detail':'workbook changed during calculation'}
        # No LO-rewritten workbook replaces the user's package: only merged cache parts do.
        handle,temp_name=tempfile.mkstemp(prefix='.~recalculate-',suffix='.tmp',dir=source.parent)
        try:
            with os.fdopen(handle,'wb') as output:output.write(content)
            read_projection(binding)
            if file_digest(source)!=source_hash:return {'status':'failed','code':'source-changed','detail':'workbook changed before cache commit'}
            os.replace(temp_name,source)
        finally:
            if Path(temp_name).exists():Path(temp_name).unlink()
        result={'status':'recalculated','id':identifier,'path':str(source),'sourceSha256':source_hash,'resultSha256':hashlib.sha256(content).hexdigest(),'formulaCount':count,'errors':errors,'diagnostics':[]}
        (job/'receipt.json').write_text(json.dumps(result,ensure_ascii=False),encoding='utf-8')
        return result
    except RuntimeError as error:return {'status':'failed','code':'runtime','detail':str(error)}
    except TimeoutError as error:return {'status':'failed','code':'timeout','detail':str(error)}
    except OSError as error:return {'status':'failed','code':'disk','detail':str(error)}
    except Exception as error:return {'status':'failed','code':'calculation','detail':str(error)}
