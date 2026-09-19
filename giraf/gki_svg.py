"""Render IRAF GKI vector plots (profiles) without Tk, X11, or recomputing fits.

GKI opcodes and 16-bit coordinate layout follow IRAF/PyRAF's gki.py. This
renderer handles the line, marker, text and fill primitives used by imexamine.
The original GKI stream is retained alongside the SVG.
"""
from html import escape
import struct


def render_gki(path, output):
    raw=path.read_bytes()
    if len(raw)<6:return False
    words=struct.unpack('<'+'h'*(len(raw)//2),raw[:len(raw)//2*2])
    if words[0]!=-1 or not 0<=words[1]<=27:
        words=struct.unpack('>'+'h'*(len(raw)//2),raw[:len(raw)//2*2])
    elements=[];index=0;width=1.;line=1;color=1;size=1.;angle=90;hjust=1;vjust=1;textcolor=1
    colors=['#ffffff','#31445d','#b96565','#559177','#557fb9','#b39157','#8b77a9','#65a0a6']
    xy=lambda x,y:(x/32768*960, (1-y/32768)*720)
    while index+3<=len(words):
        if words[index]!=-1:index+=1;continue
        opcode,length=words[index+1:index+3]
        if length<3 or index+length>len(words):break
        a=words[index+3:index+length];index+=length
        if opcode in (6,7):elements=[]
        elif opcode==15 and len(a)>=3:line,width,color=a[0],a[1]/100,a[2]
        elif opcode==17 and len(a)>=9:angle,size,hjust,vjust,textcolor=a[0],a[1]/100,a[4],a[5],a[8]
        elif opcode in (9,10,12) and len(a)>=3:
            pts=[xy(a[i],a[i+1]) for i in range(1,min(len(a)-1,1+2*a[0]),2)]
            if opcode==10:
                elements += [f'<circle cx="{x:.2f}" cy="{y:.2f}" r="1.5" fill="{colors[color%len(colors)]}"/>' for x,y in pts]
            elif pts:
                coords=' '.join(f'{x:.2f},{y:.2f}' for x,y in pts)
                dash={2:'7 5',3:'2 4',4:'7 4 2 4'}.get(line,'')
                elements.append(f'<{"polygon" if opcode==12 else "polyline"} points="{coords}" fill="{colors[color%len(colors)] if opcode==12 else "none"}" stroke="{colors[color%len(colors)]}" stroke-width="{max(.6,width):.2f}" stroke-dasharray="{dash}"/>')
        elif opcode==11 and len(a)>=3:
            x,y=xy(a[0],a[1]);text=''.join(chr(v & 255) for v in a[3:3+a[2]])
            anchor={1:'start',2:'center',3:'end'}.get(hjust,'start').replace('center','middle')
            elements.append(f'<text x="{x:.2f}" y="{y:.2f}" font-family="monospace" font-size="{max(8,12*size):.2f}" text-anchor="{anchor}" dominant-baseline="middle" fill="{colors[textcolor%len(colors)]}" transform="rotate({90-angle} {x:.2f} {y:.2f})">{escape(text)}</text>')
    if not elements:return False
    output.write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 720" role="img" aria-label="IRAF imexamine plot"><rect width="960" height="720" fill="white"/>'+''.join(elements)+'</svg>')
    return True
