"""Bake a true STEREO PAIR from the SHARP reconstruction — an Apple-style
spatial photo: one image per eye, binocular depth, no motion parallax.

The disparity is computed for the DISPLAY geometry, not the capture geometry.
Warping by the captured metric depth would be correct only if you pressed your
eye to within 40 cm of his face; on a 0.72 m panel 1.5 m away that is a ~70 px
relative shift and physically painful to fuse. What matters is where the panel
actually hangs, so each pixel is shifted by the parallax its display depth earns:

    dz       = relief * reliefDepth + inset          (metres behind the panel)
    shift_m  = (IPD/2) * dz / (viewDistance + dz)    (per eye, on the panel)

which lands at ~6 px of relative disparity — the same depth budget the relief
panel produces, so the comparison isolates the one real difference between them
(parallax on head movement) instead of comparing two different depth scales.

SHARP's layer 1 is what makes this worth doing: a forward warp tears holes at
every silhouette, and layer 1 is inpainted material sitting behind layer 0, so
the holes get filled with predicted content rather than smeared neighbours.
"""
import argparse, json
from pathlib import Path

import numpy as np
from PIL import Image
from plyfile import PlyData

SH_C0 = 0.28209479177387814


def upsample(a, w, h, mode=Image.BILINEAR):
    """768x768 square grid -> the photo's real 2:3 aspect."""
    if a.ndim == 2:
        return np.asarray(Image.fromarray(a.astype(np.float32)).resize((w, h), mode), dtype=np.float32)
    return np.stack([upsample(a[..., c], w, h, mode) for c in range(a.shape[-1])], axis=-1)


def warp(color, dz, shift_px, out_w, out_h):
    """Forward-warp one layer horizontally, z-buffered (nearest dz wins)."""
    acc = np.zeros((out_h, out_w, 3), dtype=np.float32)
    best = np.full((out_h, out_w), np.inf, dtype=np.float32)
    xs = np.arange(out_w)
    for y in range(out_h):
        tx = np.rint(xs + shift_px[y]).astype(np.int32)
        ok = (tx >= 0) & (tx < out_w)
        tgt, src, d = tx[ok], xs[ok], dz[y][ok]
        # nearest-wins: sort far->near so the nearest write lands last
        order = np.argsort(-d)
        tgt, src, d = tgt[order], src[order], d[order]
        acc[y, tgt] = color[y, src]
        best[y, tgt] = d
    return acc, best


def fill_holes(img, filled):
    """Close remaining gaps by carrying the nearest filled pixel sideways."""
    out = img.copy()
    h, w = filled.shape
    for y in range(h):
        row = np.nonzero(filled[y])[0]
        if row.size == 0:
            continue
        idx = np.searchsorted(row, np.arange(w))
        lo = row[np.clip(idx - 1, 0, row.size - 1)]
        hi = row[np.clip(idx, 0, row.size - 1)]
        pick = np.where(np.abs(np.arange(w) - lo) <= np.abs(np.arange(w) - hi), lo, hi)
        miss = ~filled[y]
        out[y, miss] = img[y, pick[miss]]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bake", default="bake")
    ap.add_argument("--tag", default="f30")
    ap.add_argument("--photo", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--width", type=int, default=768)
    ap.add_argument("--ipd", type=float, default=0.063)
    ap.add_argument("--panel-width", type=float, default=0.72)
    ap.add_argument("--view-distance", type=float, default=1.5)
    ap.add_argument("--relief-depth", type=float, default=0.2355)
    ap.add_argument("--inset", type=float, default=0.06)
    ap.add_argument("--quality", type=int, default=88)
    a = ap.parse_args()

    bake, out = Path(a.bake), Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    fit = json.load(open(bake / f"fit_{a.tag}.json"))
    z = np.load(bake / f"z_{a.tag}.npy")
    G = z.shape[-1]

    W = a.width
    H = int(round(W * 3 / 2))
    print(f"stereo pair at {W}x{H}, IPD {a.ipd*1000:.0f} mm, panel {a.panel_width} m @ {a.view_distance} m")

    # relief, normalised exactly as the runtime map is
    sub = z[0] < fit["thr"]
    z_near = float(np.percentile(z[0][sub], 0.2))
    z_far = float(np.percentile(z[0][sub], 99.0))
    rel0 = np.clip((z[0] - z_near) / (z_far - z_near), 0, 1)
    rel1 = np.clip((z[1] - z_near) / (z_far - z_near), 0, 1)

    # layer 0 colour is the real photograph, not the gaussians' own colour —
    # it is the same surface and it is sharper.
    photo = Image.open(a.photo).convert("RGB").resize((W, H), Image.LANCZOS)
    c0 = np.asarray(photo, dtype=np.float32) / 255.0
    # layer 1 colour has to come from the gaussians: it is the inpainted
    # material behind the surface, and no photograph contains it.
    v = PlyData.read(bake / f"seb_{a.tag}.ply")["vertex"]
    rgb = np.stack([v[f"f_dc_{i}"] for i in range(3)], axis=1).astype(np.float32) * SH_C0 + 0.5
    c1 = np.clip(rgb.reshape(2, G, G, 3)[1], 0, 1)

    r0 = upsample(rel0, W, H)
    r1 = upsample(rel1, W, H)
    c1 = np.clip(upsample(c1, W, H), 0, 1)

    px_per_m = W / a.panel_width
    meta = {"width": W, "height": H, "ipd": a.ipd, "view_distance": a.view_distance,
            "relief_depth": a.relief_depth, "inset": a.inset}

    for name, sign in (("L", -1.0), ("R", +1.0)):
        # A point behind the panel is displaced TOWARD the eye's own side of
        # centre, so the left eye's image shifts left.
        outs = []
        for rel, col in ((r1, c1), (r0, c0)):        # far layer first
            dz = rel * a.relief_depth + a.inset
            shift = sign * (a.ipd / 2.0) * dz / (a.view_distance + dz) * px_per_m
            outs.append((col, dz, shift))
        acc = np.zeros((H, W, 3), np.float32)
        best = np.full((H, W), np.inf, np.float32)
        for col, dz, shift in outs:
            img, d = warp(col, dz, shift, W, H)
            take = d < best
            acc[take] = img[take]
            best[take] = d[take]
        filled = np.isfinite(best)
        holes = 1.0 - filled.mean()
        acc = fill_holes(acc, filled)
        p = out / f"portrait-eye-{name}.jpg"
        Image.fromarray((np.clip(acc, 0, 1) * 255).astype(np.uint8)).save(p, quality=a.quality, optimize=True)
        meta[f"eye{name}"] = {"holes_before_fill": round(float(holes), 5),
                              "bytes": p.stat().st_size}
        print(f"  eye {name}: {p.stat().st_size/1024:.0f} KB, holes before fill {holes*100:.3f}%")

    # how much disparity did we actually produce?
    dz_near, dz_far = a.inset, a.relief_depth + a.inset
    s = lambda d: (a.ipd/2.0) * d / (a.view_distance + d) * px_per_m
    meta["disparity_px"] = {"near": round(s(dz_near), 2), "far": round(s(dz_far), 2),
                            "relative": round(2*(s(dz_far) - s(dz_near)), 2)}
    print(f"  disparity: near {s(dz_near):.2f} px, far {s(dz_far):.2f} px, "
          f"relative between eyes {2*(s(dz_far)-s(dz_near)):.2f} px")
    (out / "portrait-spatial.json").write_text(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main()
