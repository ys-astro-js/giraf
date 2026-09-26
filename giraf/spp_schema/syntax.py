"""Parse SPP procedures and statically known branches without executing source."""
import re

def without_comments(source):
    return re.sub(r'"(?:\\.|[^"\\])*"|#[^\n]*',
                  lambda m: m[0] if m[0].startswith('"') else '', source)


def procedures(source, path):
    pattern = r'^\s*(?:(?:int|real|double|bool|pointer|char)\s+)?procedure\s+(\w+)\s*\((.*?)\)'
    for match in re.finditer(pattern, source, re.M | re.S):
        tail = source[match.end():]
        begin = re.search(r'^begin\s*$', tail, re.M)
        if begin:
            body = re.split(r'^end\s*$', tail[begin.end():], maxsplit=1, flags=re.M)[0]
            yield match[1].lower(), dict(args=[v.strip() for v in match[2].split(',') if v.strip()],
                                         body=body, path=path)


def closing_brace(text, start):
    depth = 0
    quoted = False
    for i in range(start, len(text)):
        if text[i] == '"':
            quoted = not quoted
        if quoted:
            continue
        if text[i] == '{':
            depth += 1
        elif text[i] == '}':
            depth -= 1
            if not depth:
                return i
    return None


def constant_branches(body, constants):
    """Remove only branches whose simple boolean condition is proven constant."""
    pattern = r'\bif\s*\(\s*(\w+)\s*==\s*(YES|NO)\s*\)\s*\{'
    for match in reversed(list(re.finditer(pattern, body))):
        value = constants.get(match[1])
        if value not in ('YES', 'NO'):
            continue
        end = closing_brace(body, match.end()-1)
        if end is None:
            continue
        suffix = re.match(r'\s*else\s*\{', body[end+1:])
        other_end = closing_brace(body, end+suffix.end()) if suffix else None
        yes = body[match.end():end]
        no = body[end+suffix.end()+1:other_end] if other_end is not None else ''
        body = body[:match.start()] + (yes if value == match[2] else no) + body[(other_end if other_end is not None else end)+1:]
    return body


