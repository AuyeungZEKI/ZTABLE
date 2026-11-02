# -*- coding: utf-8 -*-
"""把 assets/privacy.md 转成带样式的 RTF（NSIS 许可页使用），中文用 \\uN 转义。"""
import os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(ROOT, 'assets', 'privacy.md'), encoding='utf-8').read()


def esc(s):
    out = []
    for ch in s:
        o = ord(ch)
        if ch in '\\{}':
            out.append('\\' + ch)
        elif o < 128:
            out.append(ch)
        else:
            if o > 32767:
                o -= 65536
            out.append('\\u%d?' % o)
    return ''.join(out)


def inline(s):
    s = s.replace('`', '')
    parts = re.split(r'(\*\*.+?\*\*)', s)
    r = ''
    for p in parts:
        if p.startswith('**') and p.endswith('**'):
            r += '{\\b ' + esc(p[2:-2]) + '}'
        else:
            r += esc(p)
    return r


lines = [
    '{\\rtf1\\ansi\\ansicpg936\\deff0',
    '{\\fonttbl{\\f0\\fnil\\fcharset134 Microsoft YaHei UI;}}',
    '{\\colortbl;\\red31\\green36\\blue48;\\red37\\green99\\blue235;\\red98\\green107\\blue124;}',
    '\\viewkind4\\uc1\\pard\\sl300\\slmult1\\f0\\fs18\\cf1',
]
for l in src.splitlines():
    l = l.rstrip()
    if l.startswith('# '):
        lines.append('\\pard\\sa120\\qc{\\b\\fs28\\cf2 ' + inline(l[2:]) + '}\\par')
    elif l.startswith('## '):
        lines.append('\\pard\\sb160\\sa60{\\b\\fs20\\cf2 ' + inline(l[3:]) + '}\\par')
    elif re.match(r'^\d+\. ', l):
        n, t = l.split('. ', 1)
        lines.append('\\pard\\li300\\fi-200\\sa40 ' + n + '. ' + inline(t) + '\\par')
    elif l.startswith('- '):
        lines.append('\\pard\\li300\\fi-200\\sa40 \\bullet  ' + inline(l[2:]) + '\\par')
    elif l.startswith('---'):
        lines.append('\\pard\\sa60\\par')
    elif l.strip():
        lines.append('\\pard\\sa80 ' + inline(l) + '\\par')
lines.append('}')
open(os.path.join(ROOT, 'build', 'license.rtf'), 'w', encoding='ascii').write('\n'.join(lines))
print('license.rtf ok')
