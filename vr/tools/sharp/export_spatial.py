"""Bake STEREO PAIRS for the spatial-photo hero: one image per eye.

This is the treatment Sebastian chose after seeing all three in a headset, and
the reason is sound: it is the only one of the three that shows a REAL
PHOTOGRAPH. The relief panel displaces actual geometry, so it wins on head
motion but melts slightly at the hair and silhouette where one continuous
surface has to span a depth jump. A stereo pair has no geometry to distort. It
buys that with the whole of its motion response — move your head and nothing
new appears, because there is nothing behind it to appear.

TWO PAIRS, NOT ONE
The panel is a mosaic reveal: a grey photo with the mosaic artwork showing
through wherever you look. So both images need warping, by the SAME disparity
field. If only the photo is warped, the revealed mosaic sits at zero disparity —
at the panel plane, in front of him — and reads as artwork floating on glass
rather than as his face becoming a mosaic.

DISPARITY IS COMPUTED FOR THE DISPLAY, NOT THE CAPTURE
Warping by the captured metric depth is correct only with your eye 40 cm from
his face; on a 0.72 m panel 1.5 m away that is ~70 px of relative shift and
painful to fuse. What matters is where the panel hangs:

    dz      = relief * reliefDepth + inset        (metres behind the opening)
    shift   = (IPD/2) * dz / (viewDistance + dz)  (per eye, on the panel)

ALIGNMENT
The gaussian grid covers contact-photo-professional.jpg. The panel displays
contact-photo-framed-for-mosaic.jpg, which is that image cropped to 77.8% at
(195, 72) — NCC 0.99990. The first version of this tool skipped that crop, so
the disparity field was offset ~10% of the width from the photo it was warping.
WINDOW below is the measured crop; see export_relief.py for how it was found.
"""
import argparse, json
from pathlib import Path

import numpy as np
from PIL import Image
from plyfile import PlyData
from scipy.ndimage import gaussian_filter, map_coordinates

SH_C0 = 0.28209479177387814
WINDOW = {"u0": 0.09828629032258064, "u1": 0.8762862903225808,
          "v0": 0.024193548387096774, "v1": 0.8029540566959923}


def crop_to_texture(plane, w, h, window=WINDOW, order=1):
    """Sub-pixel resample of the aligned crop straight to the texture grid.
    Does the crop and the square->2:3 unsquash in ONE interpolation."""
    G = plane.shape[-1]
    cols = np.linspace(window["u0"] * (G - 1), window["u1"] * (G - 1), w)
    rows = np.linspace(window["v0"] * (G - 1), window["v1"] * (G - 1), h)
    cc, rr = np.meshgrid(cols, rows)
    return map_coordinates(plane, [rr, cc], order=order, mode="nearest")


def warp_backward(color, shift_px, blur_px):
    """Sample the source with a per-pixel horizontal offset.

    WHY NOT A FORWARD WARP
    The first version splatted every source pixel to x + shift with a z-buffer
    and then filled the leftover gaps by carrying neighbours sideways. On the
    face and the shirt that is fine. On his HAIR it was visibly wrong: depth
    there changes per strand, so the splat scattered, left one- and two-pixel
    holes, and the hole filler smeared them into a fringe of stringy streaks
    along the whole hairline.

    A backward warp cannot tear, because every output pixel is written exactly
    once by construction. Its known weakness is sharp depth discontinuities —
    and the fix for that is the same blur that fixes the hair.

    WHY THE BLUR IS FREE HERE
    The total disparity across this whole image is about 5 px at 768 wide. At
    that magnitude there is no disocclusion to preserve — nothing is hiding
    behind anything by 5 px — so per-strand depth detail buys nothing and
    costs the artefact. Blurring the DISPARITY (never the colour) keeps the
    broad face-to-backdrop separation, which is all the depth the eye reads,
    and removes the per-strand noise that was driving the scatter.
    """
    h, w = shift_px.shape
    xs = np.arange(w)[None, :].repeat(h, 0).astype(np.float64)
    ys = np.arange(h)[:, None].repeat(w, 1).astype(np.float64)
    shift = gaussian_filter(shift_px, blur_px, mode="nearest") if blur_px > 0 else shift_px
    src_x = np.clip(xs - shift, 0, w - 1)
    out = np.empty((h, w, 3), np.float32)
    for k in range(3):
        out[..., k] = map_coordinates(color[..., k], [ys, src_x], order=1, mode="nearest")
    return out, shift


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bake", required=True)
    ap.add_argument("--tag", default="f30")
    ap.add_argument("--colour", required=True, help="layer-0 image, already in the framed crop")
    ap.add_argument("--prefix", required=True, help="output name stem, e.g. portrait-eye or portrait-mosaic-eye")
    ap.add_argument("--layer1", choices=["gaussian", "same"], default="gaussian",
                    help="retained for provenance only — the backward warp has no tears to fill, "
                         "so no inpainted layer is consumed")
    ap.add_argument("--out", required=True)
    ap.add_argument("--width", type=int, default=768)
    ap.add_argument("--ipd", type=float, default=0.063)
    ap.add_argument("--panel-width", type=float, default=0.72)
    ap.add_argument("--view-distance", type=float, default=1.5)
    ap.add_argument("--relief-depth", type=float, default=0.1951)
    ap.add_argument("--inset", type=float, default=0.06)
    ap.add_argument("--quality", type=int, default=90)
    ap.add_argument("--blur", type=float, default=4.0,
                    help="gaussian sigma on the DISPARITY field, in px. Removes per-strand "
                         "hair noise that scatters the warp; never applied to colour.")
    a = ap.parse_args()

    bake, out = Path(a.bake), Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    z = np.load(bake / f"z_{a.tag}.npy")
    fit = json.load(open(bake / f"fit_{a.tag}.json"))
    G = z.shape[-1]
    W = a.width
    H = int(round(W * 3 / 2))

    # Relief over the ALIGNED crop, normalised over the crop, exactly as
    # export_relief.py does it so the two treatments share one depth field.
    z0 = crop_to_texture(z[0], W, H)
    z1 = crop_to_texture(z[1], W, H)
    sub = z0 < fit["thr"]
    z_near = float(np.percentile(z0[sub], 0.2))
    z_far = float(np.percentile(z0[sub], 99.0))
    r0 = np.clip((z0 - z_near) / (z_far - z_near), 0, 1)
    r1 = np.clip((z1 - z_near) / (z_far - z_near), 0, 1)

    c0 = np.asarray(Image.open(a.colour).convert("RGB").resize((W, H), Image.LANCZOS), np.float32) / 255.
    if a.layer1 == "gaussian":
        v = PlyData.read(bake / f"seb_{a.tag}.ply")["vertex"]
        rgb = np.stack([v[f"f_dc_{i}"] for i in range(3)], 1).astype(np.float32) * SH_C0 + 0.5
        g1 = np.clip(rgb.reshape(2, G, G, 3)[1], 0, 1)
        c1 = np.clip(np.stack([crop_to_texture(g1[..., k], W, H) for k in range(3)], -1), 0, 1)
    else:
        # No meaningful "behind" for flat artwork — fill from itself.
        c1 = c0

    px_per_m = W / a.panel_width
    meta = {"width": W, "height": H, "ipd": a.ipd, "view_distance": a.view_distance,
            "relief_depth": a.relief_depth, "inset": a.inset, "aligned_window": WINDOW,
            "z_near_m": z_near, "z_far_m": z_far, "layer1": a.layer1,
            "colour_source": Path(a.colour).name}
    print(f"{a.prefix}: {W}x{H}  crop-aligned  z {z_near:.3f}..{z_far:.3f}")

    # One depth field for both eyes, from the visible surface only. Layer 1 was
    # only ever needed to fill forward-warp tears, and a backward warp has none.
    dz = r0 * a.relief_depth + a.inset
    for name, sign in (("L", -1.0), ("R", +1.0)):
        # A point behind the opening is displaced toward its own eye's side of
        # centre, so the LEFT eye's image shifts left.
        shift = sign * (a.ipd / 2.0) * dz / (a.view_distance + dz) * px_per_m
        acc, used = warp_backward(c0, shift, a.blur)
        p = out / f"{a.prefix}-{name}.jpg"
        Image.fromarray((np.clip(acc, 0, 1) * 255).astype(np.uint8)).save(p, quality=a.quality, optimize=True)
        meta[f"eye{name}"] = {"bytes": p.stat().st_size,
                              "shift_px_range": [round(float(used.min()), 2), round(float(used.max()), 2)]}
        print(f"  eye {name}: {p.stat().st_size/1024:.0f} KB, "
              f"shift {used.min():+.2f}..{used.max():+.2f} px")

    s = lambda d: (a.ipd / 2.0) * d / (a.view_distance + d) * px_per_m
    dzn, dzf = a.inset, a.relief_depth + a.inset
    meta["disparity_px"] = {"near": round(s(dzn), 2), "far": round(s(dzf), 2),
                            "relative": round(2 * (s(dzf) - s(dzn)), 2)}
    print(f"  disparity near {s(dzn):.2f} px, far {s(dzf):.2f} px, "
          f"relative between eyes {2*(s(dzf)-s(dzn)):.2f} px")
    (out / f"{a.prefix}.json").write_text(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main()
