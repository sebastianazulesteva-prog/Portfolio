#!/usr/bin/env python3
"""Add og:image:width/height/alt and point og:image at the site-wide
1200x630 social-preview.png card on all 15 flat pages of sesteva.com.

Fixes issue #6: portrait og:images (contact-photo-professional.jpg,
chess-hero.jpg) crop badly in a 1.91:1 summary_large_image card, and
og:image:width/height/alt are missing on all pages.
"""
import re, glob

CARD = "https://sesteva.com/images/social-preview.png"
W, H = 1200, 630

def fix(path):
    s = open(path, encoding="utf-8").read()
    orig = s

    # 1. Replace every og:image content with the brand card
    s = re.sub(
        r'(<meta property="og:image" content=")[^"]*(")',
        r'\g<1>' + CARD + r'\g<2>',
        s,
    )

    # 2. Insert og:image:width/height/alt right after the og:image line
    #    (only if not already present)
    if 'og:image:width' not in s:
        s = re.sub(
            r'(<meta property="og:image" content="[^"]*">)',
            r'\g<1>\n'
            f'  <meta property="og:image:width" content="{W}">\n'
            f'  <meta property="og:image:height" content="{H}">\n'
            '  <meta property="og:image:alt" content="Sebastian Esteva, Engineer & Communicator">',
            s,
            count=1,
        )

    # 3. Ensure twitter:card is summary_large_image (experience.html is "summary")
    s = re.sub(
        r'(<meta name="twitter:card" content=")summary(")',
        r'\g<1>summary_large_image\g<2>',
        s,
    )

    # 4. Ensure twitter:image points at the card too
    s = re.sub(
        r'(<meta name="twitter:image" content=")[^"]*(")',
        r'\g<1>' + CARD + r'\g<2>',
        s,
    )

    if s != orig:
        open(path, "w", encoding="utf-8").write(s)
        return True
    return False

changed = []
for p in sorted(glob.glob("*.html")):
    if fix(p):
        changed.append(p)

print("changed:", len(changed))
for p in changed:
    print(" ", p)
