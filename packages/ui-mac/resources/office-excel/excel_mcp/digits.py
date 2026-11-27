# Adapted for Code Puppy, 2026-11-26, from excel-mcp-server 2.3.2 (MIT).
"""The digits that Excel reads as 0-9 besides the ASCII ones.

Excel 16 reads the native digits of these scripts like ASCII digits wherever text becomes a
number, a date or a reference (typing, VALUE, criteria, INDIRECT). Any other Unicode digit,
such as a fullwidth one, is a plain character to it.
"""
_ZEROS = (1632, 1776, 2406, 2534, 2662, 2790, 2918, 3046, 3174, 3302, 3430, 3664, 3792, 3872, 4160, 6112, 6160)
_TO_ASCII = {zero + digit: str(digit) for zero in _ZEROS for digit in range(10)}

def ascii_digits(text: str) -> str:
    """``text`` with the digits Excel reads as 0-9 written as ASCII digits."""
    return text.translate(_TO_ASCII)
