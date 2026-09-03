"""Bake a SHARP 3DGS + a pixel-aligned depth map from one photo.

Wraps sharp.cli.predict.predict_image so we can (a) choose the focal length
(the source photo has no EXIF, and SHARP's 30mm fallback is wrong for an
85mm-ish studio portrait) and (b) keep the Gaussians3D in-process to pull the
depth map out of layer 0 instead of re-deriving it from the .ply.
"""
import argparse, json, sys, time
from pathlib import Path

import numpy as np
import torch

from sharp.cli.predict import predict_image
from sharp.models import PredictorParams, create_predictor
from sharp.utils import io as sio
from sharp.utils.gaussians import save_ply

NUM_LAYERS = 2  # PredictorParams.num_layers


def load_model(ckpt, device):
    sd = torch.load(ckpt, weights_only=True, map_location="cpu")
    m = create_predictor(PredictorParams())
    m.load_state_dict(sd)
    m.eval().to(device)
    return m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", required=True)
    ap.add_argument("--f35", type=float, default=30.0)
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--device", default="mps")
    ap.add_argument("--tag", default=None)
    a = ap.parse_args()

    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    tag = a.tag or f"f{int(a.f35)}"
    dev = torch.device(a.device)

    img, _, _ = sio.load_rgb(Path(a.image))
    h, w = img.shape[:2]
    f_px = sio.convert_focallength(w, h, a.f35)
    print(f"[{tag}] image {w}x{h}  f35={a.f35}mm  f_px={f_px:.1f}", flush=True)

    model = load_model(a.ckpt, dev)
    t0 = time.time()
    g = predict_image(model, img, f_px, dev)
    dt = time.time() - t0
    print(f"[{tag}] inference {dt:.1f}s", flush=True)

    xyz = g.mean_vectors[0].detach().cpu().numpy()          # (N,3) OpenCV: x right, y down, z fwd
    op = g.opacities[0].detach().cpu().numpy().reshape(-1)  # (N,)
    sv = g.singular_values[0].detach().cpu().numpy()        # (N,3)
    n = xyz.shape[0]
    grid = int(round(np.sqrt(n / NUM_LAYERS)))
    assert grid * grid * NUM_LAYERS == n, f"N={n} not {NUM_LAYERS}x{grid}^2"
    print(f"[{tag}] {n} gaussians = {NUM_LAYERS} layers x {grid}x{grid}", flush=True)

    z = xyz[:, 2].reshape(NUM_LAYERS, grid, grid)
    stats = {"tag": tag, "f35": a.f35, "f_px": float(f_px), "n": int(n),
             "grid": grid, "layers": NUM_LAYERS, "infer_s": round(dt, 2),
             "src": Path(a.image).name, "image_wh": [int(w), int(h)]}
    for L in range(NUM_LAYERS):
        zl = z[L]
        stats[f"layer{L}_z"] = {
            "min": float(zl.min()), "p01": float(np.percentile(zl, 1)),
            "median": float(np.median(zl)), "p99": float(np.percentile(zl, 99)),
            "max": float(zl.max()),
        }
        print(f"[{tag}] layer{L} z(m): min={zl.min():.3f} p1={np.percentile(zl,1):.3f} "
              f"med={np.median(zl):.3f} p99={np.percentile(zl,99):.3f} max={zl.max():.3f}", flush=True)

    # Opacity-weighted extent of the SUBJECT: gaussians whose z is in front of
    # the backdrop plane. Tells us how much real parallax there is to see.
    zl0 = z[0].reshape(-1)
    op0 = op[:grid * grid]
    solid = op0 > 0.5
    if solid.any():
        zs = zl0[solid]
        stats["subject_z_span"] = [float(np.percentile(zs, 1)), float(np.percentile(zs, 99))]
        print(f"[{tag}] solid(op>0.5) z span p1..p99 = "
              f"{np.percentile(zs,1):.3f} .. {np.percentile(zs,99):.3f} m "
              f"(depth range {np.percentile(zs,99)-np.percentile(zs,1):.3f} m)", flush=True)
    stats["opacity"] = {"mean": float(op.mean()), "frac_gt_0.5": float((op > 0.5).mean()),
                        "frac_lt_0.05": float((op < 0.05).mean())}
    stats["scale_m"] = {"median": float(np.median(sv)), "p99": float(np.percentile(sv, 99))}
    print(f"[{tag}] opacity mean={op.mean():.3f} >0.5={(op>0.5).mean():.3f} <0.05={(op<0.05).mean():.3f}", flush=True)

    np.save(out / f"z_{tag}.npy", z.astype(np.float32))
    np.save(out / f"op_{tag}.npy", op.astype(np.float32).reshape(NUM_LAYERS, grid, grid))
    save_ply(g, f_px, (h, w), out / f"seb_{tag}.ply")
    (out / f"stats_{tag}.json").write_text(json.dumps(stats, indent=2))
    print(f"[{tag}] wrote seb_{tag}.ply "
          f"({(out / f'seb_{tag}.ply').stat().st_size/1e6:.1f} MB)", flush=True)


if __name__ == "__main__":
    sys.exit(main())
