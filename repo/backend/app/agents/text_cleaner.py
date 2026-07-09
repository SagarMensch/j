"""
Text cleaner - removes markdown artifacts, tables, dashes and formats clean answers.
"""
import re


def clean_llm_output(text: str) -> str:
    if not text:
        return ""

    # Strip internal reasoning/thinking text that models sometimes leak
    reasoning_patterns = [
        r'^The operator is asking.*?(?=\n\n|\n\d)',
        r'^To provide a (?:thorough|complete|detailed) summary.*?(?=\n\n|\n\d)',
        r'^I will (?:break down|provide|analyze|explain).*?(?=\n\n|\n\d)',
        r'^Let me (?:think|analyze|break down).*?(?=\n\n|\n\d)',
        r'^Based on (?:the|my) (?:evidence|analysis|review).*?(?=\n\n|\n\d)',
        r'^The (?:question|query) (?:is asking|requires|needs).*?(?=\n\n|\n\d)',
    ]
    for pattern in reasoning_patterns:
        text = re.sub(pattern, '', text, flags=re.DOTALL | re.IGNORECASE)

    text = re.sub(r'```[\s\S]*?```', '', text)
    text = re.sub(r'`([^`]+)`', r'\1', text)

    text = re.sub(r'\|[-]+\|[-]+\|', '', text)
    text = re.sub(r'\|([^|]+)\|([^|]+)\|([^|]+)\|', r'\1: \2, \3', text)
    text = re.sub(r'\|([^|]+)\|([^|]+)\|', r'\1: \2', text)
    text = re.sub(r'^\|.*\|$', '', text, flags=re.MULTILINE)

    text = re.sub(r'^[-]{3,}$', '', text, flags=re.MULTILINE)
    text = re.sub(r'^[=]{3,}$', '', text, flags=re.MULTILINE)
    text = re.sub(r'^[_]{3,}$', '', text, flags=re.MULTILINE)

    text = re.sub(r'^#+\s*', '', text, flags=re.MULTILINE)
    text = re.sub(r'\*\*([^*]+)\*\*', r'\1', text)
    text = re.sub(r'\*([^*]+)\*', r'\1', text)
    text = re.sub(r'__([^_]+)__', r'\1', text)
    text = re.sub(r'_([^_]+)_', r'\1', text)

    text = re.sub(r'\n{3,}', '\n\n', text)
    text = re.sub(r'[ \t]+', ' ', text)
    lines = [line.strip() for line in text.split('\n')]
    text = '\n'.join(lines)
    text = text.strip()

    return text


def format_as_answer(answer: str, evidence: list[dict] = None) -> str:
    cleaned = clean_llm_output(answer)

    if not cleaned:
        return "I couldn't find a clear answer in the approved documents."

    lines = cleaned.split('\n')
    formatted_lines = []
    for line in lines:
        line = line.strip()
        if not line:
            formatted_lines.append('')
            continue

        line = re.sub(r'^\d+[\.\)]\s*', '', line)
        line = re.sub(r'^[-•*]\s*', '', line)

        line = re.sub(r'\[(\d+)\]', r'[\1]', line)

        formatted_lines.append(line)

    result = '\n'.join(formatted_lines)
    result = re.sub(r'\n{2,}', '\n\n', result)

    return result.strip()


def format_evidence_for_display(evidence: list[dict]) -> list[dict]:
    formatted = []
    for ev in evidence:
        content = ev.get('content', '')
        content = clean_llm_output(content)
        content = re.sub(r'\n{2,}', ' ', content)
        content = content.strip()

        if len(content) > 300:
            content = content[:300] + '...'

        formatted.append({
            'chunk_id': ev.get('chunk_id', ''),
            'citation_label': ev.get('citation_label', ''),
            'content': content,
            'page_start': ev.get('page_start'),
            'page_end': ev.get('page_end'),
            'document_code': ev.get('document_code', ''),
        })

    return formatted


def extract_key_points(answer: str) -> list[str]:
    cleaned = clean_llm_output(answer)
    points = []

    for line in cleaned.split('\n'):
        line = line.strip()
        if len(line) > 20 and len(line) < 200:
            points.append(line)

    if not points:
        sentences = re.split(r'[.!?]+', cleaned)
        points = [s.strip() for s in sentences if len(s.strip()) > 20][:5]

    return points[:5]
