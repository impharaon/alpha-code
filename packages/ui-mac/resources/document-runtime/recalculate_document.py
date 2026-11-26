"""Fixed Location-side adapter; caller supplies only the already-authorized workbook path."""
import json
import sys
from codepuppy_office import OfficeExcel

if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
    if len(sys.argv) != 2:raise SystemExit('expected workbook path')
    print(json.dumps(OfficeExcel.recalculate(sys.argv[1]),ensure_ascii=False))
