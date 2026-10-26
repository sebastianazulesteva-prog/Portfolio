#!/usr/bin/env python3
"""Generate the site-wide 1200x630 social preview card for sesteva.com.

Uses the site's own design tokens (index.html :root):
  --bg: #080808, --text: #f5f5f0, --ember: #b8863b
Fonts: Syne (sans) / Playfair Display (serif) are the site's Google Fonts;
fall back to DejaVu/Liberation here so the script runs anywhere.
"""
from PIL import Image, ImageDraw, ImageFont
import os

W, H = 1200, 630
BG = (8, 8, 8)
TEXT = (245, 245, 240)
EMBER = (184, 134, 59)
MUTED = (245, 245, 240, 102)

FONT_DIRS = [
    "/usr/share/fonts/truetype/dejavu",
    "/usr/share/fonts/truetype/liberation",
]

def find_font(names, size):
    for d in FONT_DIRS:
        for n in names:
            p = os.path.join(d, n)
            if os.path.exists(p):
                return ImageFont.truetype(p, size)
    return ImageFont.load_default()

serif_bold = find_font(["DejaVuSerif-Bold.ttf", "LiberationSerif-Bold.ttf"], 96)
sans_bold = find_font(["DejaVuSans-Bold.ttf", "LiberationSans-Bold.ttf"], 40)
sans_reg = find_font(["DejaVuSans.ttf", "LiberationSans-Regular.ttf"], 34)

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

# subtle ember accent bar on the left edge
d.rectangle([0, 0, 14, H], fill=EMBER)

# Name
name = "Sebastian Esteva"
d.text((70, 150), name, font=serif_bold, fill=TEXT)

# Tagline
tagline = "Engineer & Communicator"
d.text((72, 300), tagline, font=sans_bold, fill=EMBER)

# Sub-line
sub = "Hands-on projects across mechanical design, VR research, and more."
# measure and shrink to fit within 1200-72-40 width
for sz in (34, 30, 26, 22):
    f = find_font(["DejaVuSans.ttf", "LiberationSans-Regular.ttf"], sz)
    if d.textlength(sub, font=f) <= W - 72 - 40:
        d.text((72, 400), sub, font=f, fill=MUTED)
        break
else:
    d.text((72, 400), sub, font=find_font(["DejaVuSans.ttf", "LiberationSans-Regular.ttf"], 22), fill=MUTED)

# URL footer
url = "sesteva.com"
d.text((72, 520), url, font=sans_reg, fill=TEXT)

out = "images/social-preview.png"
img.save(out)
print("wrote", out, img.size, os.path.getsize(out), "bytes")
