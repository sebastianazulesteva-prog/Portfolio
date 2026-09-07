"""Bake portrait-relief.png, ALIGNED to the photo the panel actually displays.

WHY THIS EXISTS SEPARATELY FROM export_assets.py
SHARP was run on images/contact-photo-professional.jpg, because that is the
full-resolution original. But the VR panel displays
images/contact-photo-framed-for-mosaic.jpg, which the flat site's own hero
needs because it is cropped to match the mosaic artwork underneath it.

Those are NOT the same framing. Measured by normalised cross-correlation over a
scale/offset search, the framed photo is the professional one cropped to
1543.6 x 2317.6 at (195, 72) — 77.8% of the width — at NCC 0.99990, which is an
exact match, not an approximation.

So the first relief map was displacing the panel by a depth field that was
offset ~10% of the width and scaled to 78%. His nose was pushed out somewhere
over his cheek. It still looked like a face in relief, which is exactly why it
survived review: a face-shaped depth blob laid over a face is wrong in a way
that reads as "slightly odd lighting" rather than as a misalignment.

This tool crops the gaussian grid to that measured window before unsquashing it,
and renormalises the depth range over the crop so the full 0..1 spans what is
actually visible. Everything else matches export_assets.py's relief_png().
"""
import argparse, json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import map_coordinates

# The measured window, as a fraction of the professional photo. Recompute with
# tools/sharp/align_crop.py if either source image is ever replaced.
WINDOW = {"u0": 0.09828629032258064, "u1": 0.8762862903225808,
          "v0": 0.024193548387096774, "v1": 0.8029540566959923}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bake", required=True, help="dir holding z_<tag>.npy + fit_<tag>.json")
    ap.add_argument("--tag", default="f30")
    ap.add_argument("--out", required=True)
    ap.add_argument("--tex-w", type=int, default=512)
    ap.add_argument("--tex-h", type=int, default=768)
    ap.add_argument("--window", default=None, help="JSON override for the crop window")
    a = ap.parse_args()

    bake, out = Path(a.bake), Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    z = np.load(bake / f"z_{a.tag}.npy")
    fit = json.load(open(bake / f"fit_{a.tag}.json"))
    w = json.loads(a.window) if a.window else WINDOW
    G = z.shape[-1]

    # Sub-pixel resample of the crop window straight to the texture grid. This
    # does the crop and the square->2:3 unsquash in one interpolation instead of
    # two, so the silhouette is resampled once.
    cols = np.linspace(w["u0"] * (G - 1), w["u1"] * (G - 1), a.tex_w)
    rows = np.linspace(w["v0"] * (G - 1), w["v1"] * (G - 1), a.tex_h)
    cc, rr = np.meshgrid(cols, rows)

    def sample(plane, order=1):
        return map_coordinates(plane, [rr, cc], order=order, mode="nearest")

    z0 = sample(z[0])
    # Renormalise over the CROP: the old range was set by percentiles over the
    # whole professional frame, which includes backdrop the panel never shows,
    # so part of the 0..1 budget was being spent outside the picture.
    sub = z0 < fit["thr"]
    if sub.sum() < 64:
        raise SystemExit("crop window contains almost no subject — wrong window?")
    z_near = float(np.percentile(z0[sub], 0.2))
    z_far = float(np.percentile(z0[sub], 99.0))
    span = z_far - z_near
    rel = np.clip((z0 - z_near) / span, 0.0, 1.0)

    gy, gx = np.gradient(rel)
    edge = np.hypot(gx, gy)
    e99 = float(np.percentile(edge, 99.5)) or 1.0

    rgb = np.stack([rel, sub.astype(np.float32), np.clip(edge / e99, 0, 1)], axis=-1)
    p = out / "portrait-relief.png"
    Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8), "RGB").save(p, optimize=True)

    meta = {"aligned_window": w, "z_near_m": z_near, "z_far_m": z_far,
            "relief_m": span, "tex": [a.tex_w, a.tex_h], "edge_norm": e99,
            "subject_frac": float(sub.mean()), "png_bytes": p.stat().st_size}
    (out / "portrait-relief.json").write_text(json.dumps(meta, indent=2))
    print(f"  {p.name}: {a.tex_w}x{a.tex_h}  relief span = {span:.4f} m "
          f"(z {z_near:.3f}..{z_far:.3f})  subject {sub.mean()*100:.1f}%  "
          f"{p.stat().st_size/1024:.0f} KB")
    print(f"  reliefDepth for the component: {span:.4f}")


if __name__ == "__main__":
    main()
