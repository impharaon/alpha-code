# Adapted for Code Puppy, 2026-11-26, from excel-mcp-server 2.3.2 (MIT).
"""Spill references: ``A1#`` as people write it, ``_xlfn.ANCHORARRAY(A1)`` as Excel stores it."""
import re
_OPERAND = "(?:'(?:[^']|'')+'!|[\\w.$]+!)?[\\w.$\\\\?]+"
_STORED = re.compile(f'(?:_xlfn\\.)?ANCHORARRAY\\(({_OPERAND})\\)', re.IGNORECASE)
_OPERAND_END = re.compile(f'{_OPERAND}$')

def store_spills(formula: str) -> str:
    """Rewrite ``A1#`` as ``_xlfn.ANCHORARRAY(A1)``."""
    if '#' not in formula:
        return formula
    result = ''
    quote = ''
    depth = 0
    for character in formula:
        if quote:
            quote = '' if character == quote else quote
        elif character in '"\'':
            quote = character
        elif character == '[':
            depth += 1
        elif character == ']':
            depth -= 1
        elif character == '#' and depth == 0 and (operand := _OPERAND_END.search(result)):
            result = f'{result[:operand.start()]}_xlfn.ANCHORARRAY({operand.group()})'
            continue
        result += character
    return result

def show_spills(formula: str) -> str:
    """Rewrite ``_xlfn.ANCHORARRAY(A1)`` as ``A1#``."""
    return _STORED.sub('\\1#', formula)
