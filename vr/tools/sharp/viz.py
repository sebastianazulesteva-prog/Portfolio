import sys
import numpy as np
from PIL import Image

tag = sys.argv[1] if len(sys.argv) > 1 else "f85"
d = sys.argv[2] if len(sys.argv) > 2 else "bake"
z = np.load(f"{d}/z_{tag}.npy")     # (L, G, G) metric depth
op = np.load(f"{d}/op_{tag}.npy")

def norm_img(a, lo=1, hi=99):
    v0, v1 = np.percentile(a, [lo, hi])
    return np.clip((a - v0) / max(v1 - v0, 1e-9), 0, 1)

tiles = []
for L in range(z.shape[0]):
    disp = 1.0 / z[L]                      # disparity reads better than raw z
    tiles.append(norm_img(disp))
    print(f"layer{L}: z {z[L].min():.3f}..{z[L].max():.3f}  "
          f"disp {disp.min():.4f}..{disp.max():.4f}")
    # depth discontinuity magnitude - where the silhouette is
    gy, gx = np.gradient(disp)
    grad = np.hypot(gx, gy)
    print(f"        |grad disp| p99={np.percentile(grad,99):.4f} max={grad.max():.4f}")

row = np.concatenate([np.concatenate(tiles, axis=1),
                      np.concatenate([norm_img(op[L], 0, 100) for L in range(op.shape[0])], axis=1)], axis=0)
Image.fromarray((row * 255).astype(np.uint8)).save(f"{d}/viz_{tag}.png")
print("wrote", f"{d}/viz_{tag}.png", "(top: disparity L0|L1, bottom: opacity L0|L1)")

# per-layer z difference: how far BEHIND the surface the inpainted layer sits
dz = z[1] - z[0]
print(f"layer1 - layer0 depth: med={np.median(dz):.4f} p99={np.percentile(dz,99):.4f} max={dz.max():.4f}")
