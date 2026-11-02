# Generates app icons (web + Android launcher). python3 scripts/make-icons.py
from PIL import Image, ImageDraw, ImageFont
import os
NAVY=(30,58,95); CREAM=(247,245,242); AMBER=(180,83,9)
FONT='/usr/share/fonts/truetype/sand-box/google/IBM Plex Serif/IBMPlexSerif-SemiBold.ttf'
if not os.path.exists(FONT): FONT='/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'
def glyph(d, S, cx, cy, scale):
    # Serif "L" with an amber underline "shelf" — a larder shelf
    f=ImageFont.truetype(FONT, int(S*0.62*scale))
    bb=d.textbbox((0,0),'L',font=f); w=bb[2]-bb[0]; h=bb[3]-bb[1]
    d.text((cx-w/2-bb[0], cy-h/2-bb[1]-S*0.04*scale),'L',font=f,fill=CREAM)
    y=cy+h/2+S*0.02*scale; d.rounded_rectangle([cx-S*0.24*scale,y,cx+S*0.24*scale,y+S*0.045*scale],radius=S*0.02*scale,fill=AMBER)
def full(S, round_=False, maskable=False):
    im=Image.new('RGBA',(S,S),(0,0,0,0)); d=ImageDraw.Draw(im)
    if maskable: d.rectangle([0,0,S,S],fill=NAVY)
    elif round_: d.ellipse([0,0,S-1,S-1],fill=NAVY)
    else: d.rounded_rectangle([0,0,S-1,S-1],radius=S*0.22,fill=NAVY)
    glyph(d,S,S/2,S/2, 0.8 if maskable else 1.0)
    return im
def fg(S):
    im=Image.new('RGBA',(S,S),(0,0,0,0)); d=ImageDraw.Draw(im); glyph(d,S,S/2,S/2,0.62); return im
full(192).save('icon-192.png'); full(512).save('icon-512.png'); full(512,maskable=True).save('icon-maskable-512.png')
res='capacitor/android/app/src/main/res'
for dpi,sz in {'mdpi':48,'hdpi':72,'xhdpi':96,'xxhdpi':144,'xxxhdpi':192}.items():
    full(sz*4).resize((sz,sz),Image.LANCZOS).save(f'{res}/mipmap-{dpi}/ic_launcher.png')
    full(sz*4,round_=True).resize((sz,sz),Image.LANCZOS).save(f'{res}/mipmap-{dpi}/ic_launcher_round.png')
    f=int(sz*108/48); fg(f*2).resize((f,f),Image.LANCZOS).save(f'{res}/mipmap-{dpi}/ic_launcher_foreground.png')
open(f'{res}/values/ic_launcher_background.xml','w').write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#1E3A5F</color>\n</resources>\n')
