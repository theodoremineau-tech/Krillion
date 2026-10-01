"""Clean drafting debris out of question files:
- chained .replace('...', '') calls
- entries containing '(', ')' or '?' (notes, dup markers)
Usage: python3 server/sanitize.py server/questions/*.js
"""
import re, sys

def clean_tier(m):
    quote_body = m.group(1)
    parts = [p for p in re.split(r';', quote_body)]
    keep = [p for p in parts if not re.search(r"[()]|\? no\b", p)]
    return "'" + ';'.join(keep).strip().rstrip(';') + "'"

for path in sys.argv[1:]:
    s = open(path).read()
    orig = s
    s = re.sub(r"(?:\.replace\((?:'[^'\n]*'|/[^\n]*?/[gimuy]*), (?:''|\"'\")\))+", '', s)
    # only touch single-quoted literals that look like answer sheets (contain ';')
    s = re.sub(r"'((?:[^'\\\n]|\\.)*;(?:[^'\\\n]|\\.)*)'", clean_tier, s)
    if s != orig:
        open(path, 'w').write(s)
        print('cleaned', path)
