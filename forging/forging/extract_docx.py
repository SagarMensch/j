import zipfile
import xml.etree.ElementTree as ET
import sys

def extract_text_from_docx(docx_path):
    text = []
    try:
        with zipfile.ZipFile(docx_path) as z:
            xml_content = z.read('word/document.xml')
            tree = ET.fromstring(xml_content)
            ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
            for paragraph in tree.findall('.//w:p', ns):
                p_text = ''
                for run in paragraph.findall('.//w:r', ns):
                    t = run.find('.//w:t', ns)
                    if t is not None and t.text:
                        p_text += t.text
                if p_text.strip():
                    text.append(p_text.strip())
        return '\n'.join(text)
    except Exception as e:
        return str(e)

if __name__ == '__main__':
    if len(sys.argv) > 2:
        output_text = extract_text_from_docx(sys.argv[1])
        with open(sys.argv[2], 'w', encoding='utf-8') as f:
            f.write(output_text)
