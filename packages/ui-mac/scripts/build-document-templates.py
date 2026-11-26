"""Application-authored Chinese Office templates and font instances (2026-11-26)."""
from pathlib import Path
import hashlib,json,sys,zipfile
from lxml import etree


def custom_properties(path, source):
    ns='http://schemas.openxmlformats.org/officeDocument/2006/custom-properties'
    vt='http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes'
    root=etree.Element('{%s}Properties'%ns,nsmap={None:ns,'vt':vt})
    for index,(name,value) in enumerate([('CodePuppyTemplateSource',source),('CodePuppyTemplateVersion','1')],2):
        prop=etree.SubElement(root,'{%s}property'%ns,fmtid='{D5CDD505-2E9C-101B-9397-08002B2CF9AE}',pid=str(index),name=name)
        etree.SubElement(prop,'{%s}lpwstr'%vt).text=value
    with zipfile.ZipFile(path) as archive:parts={x:archive.read(x) for x in archive.namelist() if not x.endswith('/')}
    parts['docProps/custom.xml']=etree.tostring(root,xml_declaration=True,encoding='UTF-8')
    if 'word/theme/theme1.xml' in parts:
        theme=etree.fromstring(parts['word/theme/theme1.xml']);a={'a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
        for group,family in [('majorFont','Noto Sans SC'),('minorFont','Noto Serif SC')]:
            for font in theme.xpath('//a:'+group+'/a:latin|//a:'+group+'/a:ea|//a:'+group+'/a:font[@script="Hans" or @script="Hant"]',namespaces=a):font.set('typeface',family)
        parts['word/theme/theme1.xml']=etree.tostring(theme,xml_declaration=True,encoding='UTF-8')
    types=etree.fromstring(parts['[Content_Types].xml'])
    etree.SubElement(types,'{http://schemas.openxmlformats.org/package/2006/content-types}Override',PartName='/docProps/custom.xml',ContentType='application/vnd.openxmlformats-officedocument.custom-properties+xml')
    rels=etree.fromstring(parts['_rels/.rels'])
    etree.SubElement(rels,'{http://schemas.openxmlformats.org/package/2006/relationships}Relationship',Id='CodePuppyTemplate',Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties',Target='docProps/custom.xml')
    parts['[Content_Types].xml']=etree.tostring(types,xml_declaration=True,encoding='UTF-8')
    parts['_rels/.rels']=etree.tostring(rels,xml_declaration=True,encoding='UTF-8')
    # Fixed ZIP timestamps make the generated identity reproducible.
    with zipfile.ZipFile(path,'w',zipfile.ZIP_DEFLATED) as archive:
        for name,data in sorted(parts.items()):
            info=zipfile.ZipInfo(name,(2026,11,26,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;archive.writestr(info,data)


def templates(root):
    from docx import Document
    from docx.shared import Mm,Pt
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from openpyxl import Workbook
    from openpyxl.styles import Font,PatternFill,Alignment
    from pptx import Presentation
    from pptx.util import Inches
    root.mkdir(parents=True,exist_ok=True)
    doc=Document();section=doc.sections[0]
    section.page_width=Mm(210);section.page_height=Mm(297)
    section.top_margin=section.bottom_margin=Mm(22);section.left_margin=section.right_margin=Mm(24)
    for style in doc.styles:
        if style.type!=1:continue
        family='Noto Sans SC' if style.name.startswith(('Heading','Title')) else 'Noto Serif SC'
        style.font.name=family;style.font.size=Pt(11 if family=='Noto Serif SC' else 16)
        style.element.get_or_add_rPr().get_or_add_rFonts().set(qn('w:eastAsia'),family)
        style.paragraph_format.space_after=Pt(8)
        if family=='Noto Sans SC':style.paragraph_format.keep_with_next=True
    section.header.paragraphs[0].text='中文报告'
    footer=section.footer.paragraphs[0];footer.text='第 '
    field=OxmlElement('w:fldSimple');field.set(qn('w:instr'),'PAGE');footer._p.append(field);footer.add_run(' 页')
    doc.add_heading('报告标题',0);doc.add_paragraph('摘要与结论')
    doc.add_heading('目录',1);toc=OxmlElement('w:fldSimple');toc.set(qn('w:instr'),'TOC \\o "1-3" \\h \\z \\u');doc.add_paragraph()._p.append(toc)
    doc.add_heading('正文',1);doc.add_paragraph('从这里开始撰写报告。')
    table=doc.add_table(rows=2,cols=2);table.style='Light Shading Accent 1';table.cell(0,0).text='项目';table.cell(0,1).text='说明'
    path=root/'chinese-report.docx';doc.save(path);custom_properties(path,'bundled:chinese-report')
    workbook=Workbook();workbook._fonts[0]=Font(name='Noto Sans SC');sheet=workbook.active;sheet.title='数据';sheet.append(['项目','数值','日期','比例'])
    sheet.freeze_panes='A2';sheet.column_dimensions['A'].width=24;sheet.column_dimensions['B'].width=18;sheet.column_dimensions['C'].width=20;sheet.column_dimensions['D'].width=18
    for cell in sheet[1]:cell.font=Font(name='Noto Sans SC',bold=True,color='FFFFFF');cell.fill=PatternFill('solid',fgColor='24445C');cell.alignment=Alignment(vertical='center')
    for row in sheet.iter_rows(min_row=2,max_row=2):
        for cell in row:cell.font=Font(name='Noto Sans SC');cell.alignment=Alignment(wrap_text=True)
    sheet['B2'].number_format='#,##0.00';sheet['C2'].number_format='yyyy-mm-dd';sheet['D2'].number_format='0.0%'
    sheet.print_title_rows='1:1';sheet.print_area='A1:D2';sheet.page_setup.orientation='landscape';sheet.page_setup.paperSize=sheet.PAPERSIZE_A4
    sheet.oddHeader.center.text='数据分析';sheet.oddFooter.center.text='第 &P 页 / 共 &N 页'
    path=root/'chinese-analysis.xlsx';workbook.save(path);custom_properties(path,'bundled:chinese-analysis')
    presentation=Presentation();presentation.slide_width=Inches(13.333);presentation.slide_height=Inches(7.5)
    slide=presentation.slides.add_slide(presentation.slide_layouts[0]);slide.shapes.title.text='汇报标题';slide.placeholders[1].text='主题与结论'
    slide.notes_slide.notes_text_frame.text='在这里填写讲者备注。'
    path=root/'chinese-presentation.pptx';presentation.save(path)
    with zipfile.ZipFile(path) as archive:parts={name:archive.read(name) for name in archive.namelist()}
    for name in list(parts):
        if not name.startswith('ppt/theme/') or not name.endswith('.xml'):continue
        theme=etree.fromstring(parts[name]);a={'a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
        for node in theme.xpath('//a:latin|//a:ea|//a:font[@script="Hans" or @script="Hant"]',namespaces=a):node.set('typeface','Noto Sans SC')
        palette=['16324F','FFFFFF','24445C','F3F6F8','247BA0','30A18E','E6A23C','8E6C9C','5E8C6A','C06C60','247BA0','8E6C9C']
        for slot,color in zip(theme.xpath('//a:clrScheme/*',namespaces=a),palette):
            for child in list(slot):slot.remove(child)
            etree.SubElement(slot,'{'+a['a']+'}srgbClr',val=color)
        parts[name]=etree.tostring(theme,encoding='UTF-8',xml_declaration=True)
    with zipfile.ZipFile(path,'w',zipfile.ZIP_DEFLATED) as archive:
        for name,data in parts.items():archive.writestr(name,data)
    custom_properties(path,'bundled:chinese-presentation')
    # Validate the generated containers, not a second hand-written representation.
    assert Document(root/'chinese-report.docx').styles['Normal'].font.name=='Noto Serif SC'
    from openpyxl import load_workbook
    check=load_workbook(root/'chinese-analysis.xlsx');assert check.active.freeze_panes=='A2' and check.active['D2'].number_format=='0.0%'
    assert len(Presentation(root/'chinese-presentation.pptx').slide_masters)>0
    for filename in ['chinese-report.docx','chinese-analysis.xlsx','chinese-presentation.pptx']:
        with zipfile.ZipFile(root/filename) as archive:
            assert archive.testzip() is None
            properties=etree.fromstring(archive.read('docProps/custom.xml'))
            assert {p.get('name') for p in properties}=={'CodePuppyTemplateSource','CodePuppyTemplateVersion'}



def fonts(config,root):
    from fontTools.ttLib import TTFont
    from fontTools.varLib.instancer import instantiateVariableFont
    root.mkdir(parents=True,exist_ok=True)
    outputs=[]
    for source in config['sources']:
        if not source['path'].endswith('.ttf'):continue
        family='Noto Sans SC' if source['path'].startswith('Sans/') else 'Noto Serif SC'
        for weight,style in [(400,'Regular'),(700,'Bold')]:
            font=TTFont(source['local']);font.recalcTimestamp=False
            instance=instantiateVariableFont(font,{'wght':weight},inplace=True)
            # These OFL files declare no Reserved Font Name. Make static styles explicit.
            names=instance['name'];ps=family.replace(' ','')+'-'+style
            for ident,text in [(1,family),(2,style),(3,ps),(4,family+' '+style),(6,ps),(16,family),(17,style)]:
                for record in list(names.names):
                    if record.nameID==ident:names.removeNames(nameID=ident)
                names.setName(text,ident,3,1,0x409)
            instance['OS/2'].usWeightClass=weight
            instance['OS/2'].fsSelection=(instance['OS/2'].fsSelection & ~96) | (32 if weight==700 else 64)
            instance['head'].macStyle=(instance['head'].macStyle & ~1) | (1 if weight==700 else 0)
            path=root/(ps+'.ttf');instance.save(path)
            assert 'glyf' in instance and 'fvar' not in instance
            assert set(map(ord,'中文报告销售汇总微软雅黑宋体黑体，。')).issubset(instance.getBestCmap())
            outputs.append({'path':'fonts/'+path.name,'family':family,'weight':weight,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
    return outputs

if __name__=='__main__':
    output=Path(sys.argv[1]);config=json.loads(Path(sys.argv[2]).read_text())
    instances=fonts(config,output/'fonts');templates(output/'templates')
    (output/'instances.json').write_text(json.dumps(instances,ensure_ascii=False,indent=2)+'\n')
