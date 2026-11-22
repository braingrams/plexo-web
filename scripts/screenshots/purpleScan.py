"""Share of visibly purple pixels (hue 250-310, saturation > 0.25, value > 0.25) per screenshot.
   python3 scripts/screenshots/purpleScan.py docs/screenshots [threshold_pct]"""
import sys, os, colorsys
from PIL import Image
root = sys.argv[1]; thr = float(sys.argv[2]) if len(sys.argv) > 2 else 0.3
out = []
for d, _, fs in os.walk(root):
    for f in fs:
        if not f.endswith(".png"): continue
        p = os.path.join(d, f)
        im = Image.open(p).convert("RGB"); im.thumbnail((360, 360))
        px = list(im.getdata()); n = 0
        for r, g, b in px:
            h, s, v = colorsys.rgb_to_hsv(r/255, g/255, b/255)
            if 250 <= h*360 <= 310 and s > .25 and v > .25: n += 1
        pct = 100*n/len(px)
        if pct >= thr: out.append((pct, p))
for pct, p in sorted(out, reverse=True): print(f"{pct:5.2f}%  {p}")
print(len(out), "files over", thr, "%")
