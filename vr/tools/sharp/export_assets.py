"""Turn one SHARP bake into the two runtime assets for /vr.

  A) portrait-relief.png  - RGB: R = relief (8-bit, near->far), G = subject mask,
     B = silhouette-edge mask. Drives a depth-displaced panel (option 1).
  B) portrait.splat       - subject-only 3D gaussians, 32-byte rows, in three.js
     axes, life-size, origin at the head centre (option 2).

SHARP facts this relies on (all verified, see the session notes):
  * gaussians flatten as (num_layers=2, 768, 768); layer 0 is the visible
    surface, layer 1 the inpainted layer behind it.
  * OpenCV axes: x right, y DOWN, z FORWARD. three.js wants y up, z back.
  * predicted z is EXACTLY proportional to the assumed focal length, so f35
    only sets depth relief. f35=30 lands life-size, hence the f30 bake.
  * .ply stores sRGB-encoded SH0, log scales, sigmoid-logit opacity,
    quaternions as [w,x,y,z] - the same order .splat wants.
"""
import argparse, json, struct
from pathlib import Path

import numpy as np
from PIL import Image
from plyfile import PlyData

SH_C0 = 0.28209479177387814


def relief_png(z, op, fit, out, tex_w, tex_h):
    """R = relief, G = subject mask, B = silhouette edge. 8-bit, linear, filterable."""
    G = z.shape[-1]
    z0 = z[0]
    sub = z0 < fit["thr"]
    z_near = float(np.percentile(z0[sub], 0.2))
    z_far = float(np.percentile(z0[sub], 99.0))
    span = z_far - z_near
    rel = np.clip((z0 - z_near) / span, 0.0, 1.0)   # 0 = nearest, 1 = subject back / backdrop

    def to_aspect(a, mode=Image.BILINEAR):
        # the 768x768 grid is the 2:3 photo squashed square - unsquash it
        return np.asarray(Image.fromarray(a.astype(np.float32), mode="F")
                          .resize((tex_w, tex_h), mode), dtype=np.float32)

    rel_r = to_aspect(rel)
    sub_r = to_aspect(sub.astype(np.float32))
    gy, gx = np.gradient(rel_r)
    edge = np.hypot(gx, gy)
    e99 = float(np.percentile(edge, 99.5)) or 1.0
    edge_r = np.clip(edge / e99, 0.0, 1.0)

    rgb = np.stack([rel_r, sub_r, edge_r], axis=-1)
    Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8), "RGB").save(out, optimize=True)
    meta = {"z_near_m": z_near, "z_far_m": z_far, "relief_m": span,
            "tex": [tex_w, tex_h], "edge_norm": e99,
            "subject_frac": float(sub.mean()), "png_bytes": out.stat().st_size}
    print(f"  A) {out.name}: {tex_w}x{tex_h}  relief span = {span:.4f} m "
          f"(z {z_near:.3f}..{z_far:.3f})  {out.stat().st_size/1024:.0f} KB")
    return meta


def load_ply_raw(path):
    v = PlyData.read(path)["vertex"]
    xyz = np.stack([v["x"], v["y"], v["z"]], axis=1).astype(np.float32)
    rgb = np.stack([v[f"f_dc_{i}"] for i in range(3)], axis=1).astype(np.float32) * SH_C0 + 0.5
    opa = 1.0 / (1.0 + np.exp(-np.asarray(v["opacity"], dtype=np.float32)))
    scl = np.exp(np.stack([v[f"scale_{i}"] for i in range(3)], axis=1).astype(np.float32))
    quat = np.stack([v[f"rot_{i}"] for i in range(4)], axis=1).astype(np.float32)  # w,x,y,z
    return xyz, rgb, opa, scl, quat


def quat_flip_yz(q):
    """Pre-multiply each rotation by D = diag(1,-1,-1) (a 180 deg turn about X).

    D is orthogonal with det +1, so cov -> D R S^2 R^T D^T = (DR) S^2 (DR)^T:
    the scales are untouched and only the rotation changes. As a quaternion,
    D is (w,x,y,z) = (0,1,0,0), so q_new = q_D * q_old.
    """
    w, x, y, z = q[:, 0], q[:, 1], q[:, 2], q[:, 3]
    # Hamilton product (0,1,0,0) * (w,x,y,z)
    return np.stack([-x, w, -z, y], axis=1)


def write_splat(sel, xyz, rgb, opa, scl, quat, out, centre):
    n = int(sel.sum())
    p = xyz[sel].copy()
    p[:, 1] *= -1.0
    p[:, 2] *= -1.0          # OpenCV -> three.js
    p -= centre
    q = quat_flip_yz(quat[sel])
    q /= np.linalg.norm(q, axis=1, keepdims=True)

    buf = np.zeros((n, 32), dtype=np.uint8)
    buf[:, 0:12] = p.astype("<f4").view(np.uint8).reshape(n, 12)
    buf[:, 12:24] = scl[sel].astype("<f4").view(np.uint8).reshape(n, 12)
    buf[:, 24:27] = np.clip(rgb[sel] * 255.0, 0, 255).astype(np.uint8)
    buf[:, 27] = np.clip(opa[sel] * 255.0, 0, 255).astype(np.uint8)
    buf[:, 28:32] = np.clip(q * 128.0 + 128.0, 0, 255).astype(np.uint8)
    out.write_bytes(buf.tobytes())
    print(f"  B) {out.name}: {n} gaussians  {out.stat().st_size/1e6:.2f} MB")
    return {"n": n, "bytes": out.stat().st_size}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bake", default="bake")
    ap.add_argument("--tag", default="f30")
    ap.add_argument("--out", required=True)
    ap.add_argument("--tex-w", type=int, default=512)
    ap.add_argument("--tex-h", type=int, default=768)
    ap.add_argument("--min-opacity", type=float, default=0.04)
    ap.add_argument("--lod", type=int, default=2, help="also emit a NxN-decimated splat")
    ap.add_argument("--lod-scale", type=float, default=1.45, help="gaussian widening for the LOD")
    a = ap.parse_args()

    bake = Path(a.bake); out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    z = np.load(bake / f"z_{a.tag}.npy"); op = np.load(bake / f"op_{a.tag}.npy")
    fit = json.load(open(bake / f"fit_{a.tag}.json"))
    G = z.shape[-1]
    print(f"bake {a.tag}: {z.shape} grid, threshold z<{fit['thr']}")

    meta = {"tag": a.tag, "fit": fit}
    meta["relief"] = relief_png(z, op, fit, out / "portrait-relief.png", a.tex_w, a.tex_h)

    xyz, rgb, opa, scl, quat = load_ply_raw(bake / f"seb_{a.tag}.ply")
    L = xyz.shape[0] // (G * G)
    zg = xyz[:, 2].reshape(L, G, G)

    subject = (xyz[:, 2] < fit["thr"])
    solid = opa > a.min_opacity
    # layer 1 is a near-duplicate of layer 0 except at silhouettes, where it
    # holds the inpainted material that makes disocclusion work. Keep only the
    # part that actually differs.
    dz = np.abs(zg[1] - zg[0]).reshape(-1)
    keep_l = np.ones(L * G * G, dtype=bool)
    keep_l[G * G:] = dz > 0.002
    sel = subject & solid & keep_l
    print(f"  prune: subject {subject.mean():.3f} | opacity>{a.min_opacity} {solid.mean():.3f} "
          f"| layer1 kept {(dz > 0.002).mean():.3f} -> {sel.sum()} of {sel.size}")

    # Origin at the centre of the bust's ROBUST bounding box (1st-99th
    # percentile per axis), not the median and not the raw min/max: the median
    # sits down in the torso because that is where most of the pixels are, and
    # the raw extremes are set by a handful of silhouette stragglers. The
    # percentile box is what a viewer would call the middle of him.
    hp = xyz[sel].copy(); hp[:, 1] *= -1; hp[:, 2] *= -1
    centre = np.array([(np.percentile(hp[:, i], 1) + np.percentile(hp[:, i], 99)) / 2
                       for i in range(3)], dtype=np.float32)
    print(f"  centre (three.js axes) = {centre.round(4).tolist()}")
    meta["splat"] = write_splat(sel, xyz, rgb, opa, scl, quat, out / "portrait.splat", centre)
    meta["splat"]["centre"] = centre.tolist()

    if a.lod > 1:
        k = a.lod
        keep_grid = np.zeros((G, G), dtype=bool); keep_grid[::k, ::k] = True
        dec = np.tile(keep_grid.reshape(-1), L)
        sel_lod = sel & dec
        # Widen to cover the dropped neighbours. The geometric answer for a kxk
        # decimation is xk, but SHARP's gaussians already overlap generously and
        # x2 visibly over-blurs into a smear — the shoulders lose their edge
        # entirely. Measured against the full-resolution splat, ~1.45 closes the
        # holes without turning him to soup.
        scl_lod = scl * a.lod_scale
        meta["splat_lod"] = write_splat(sel_lod, xyz, rgb, opa, scl_lod, quat,
                                        out / "portrait-lod.splat", centre)
        meta["splat_lod"]["lod"] = k

    (out / "portrait-bake.json").write_text(json.dumps(meta, indent=2))
    print(f"  wrote {out/'portrait-bake.json'}")


if __name__ == "__main__":
    main()
