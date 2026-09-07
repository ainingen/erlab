"""立ち絵の背景（MJが描いた無地のグレー）を抜いて透過PNGにする。

やり方:
  1. 四隅から背景色を推定する
  2. 背景色に近い画素のうち、画像の縁からつながっているものだけを塗り分ける
     （単純な色キーだと、白衣の影など内側の似た色まで穴が開く）
  3. 縁がギザつかないよう、境界付近は色の距離に応じて半透明にする

使い方:
  python tools/cutout.py assets/portraits/*.png
  python tools/cutout.py --tolerance 30 assets/portraits/kanae_normal.png
"""

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image

# 背景とみなす色の距離。T_LO 以下は完全に透明、T_HI 以上は完全に不透明。
T_LO = 8.0
T_HI = 34.0


def estimate_background(rgb, patch=12):
    """四隅の中央値を背景色とする。"""
    h, w, _ = rgb.shape
    corners = np.concatenate([
        rgb[:patch, :patch].reshape(-1, 3),
        rgb[:patch, w - patch:].reshape(-1, 3),
        rgb[h - patch:, :patch].reshape(-1, 3),
        rgb[h - patch:, w - patch:].reshape(-1, 3),
    ])
    return np.median(corners, axis=0)


def flood_from_border(mask):
    """mask（背景色に近いか）のうち、画像の縁からつながっている領域だけ True で返す。

    走査線方式。背景の画素を一度ずつ見るだけなので、素のPythonでも十分速い。
    """
    h, w = mask.shape
    out = np.zeros((h, w), dtype=bool)
    m = mask  # 参照を短く

    stack = []
    for x in range(w):
        if m[0, x]:
            stack.append((0, x))
        if m[h - 1, x]:
            stack.append((h - 1, x))
    for y in range(h):
        if m[y, 0]:
            stack.append((y, 0))
        if m[y, w - 1]:
            stack.append((y, w - 1))

    while stack:
        y, x = stack.pop()
        if out[y, x] or not m[y, x]:
            continue

        # 左右に伸ばせるだけ伸ばす
        x0 = x
        while x0 > 0 and m[y, x0 - 1] and not out[y, x0 - 1]:
            x0 -= 1
        x1 = x
        while x1 < w - 1 and m[y, x1 + 1] and not out[y, x1 + 1]:
            x1 += 1
        out[y, x0:x1 + 1] = True

        # 上下の行で、まだ塗っていない背景画素を種にする
        for ny in (y - 1, y + 1):
            if ny < 0 or ny >= h:
                continue
            row_m = m[ny, x0:x1 + 1]
            row_o = out[ny, x0:x1 + 1]
            for i in np.flatnonzero(row_m & ~row_o):
                stack.append((ny, x0 + int(i)))

    return out


def cutout(path, t_lo=T_LO, t_hi=T_HI):
    img = Image.open(path).convert('RGB')
    rgb = np.asarray(img).astype(np.float32)

    bg = estimate_background(rgb)
    dist = np.sqrt(((rgb - bg) ** 2).sum(axis=2))

    background = flood_from_border(dist < t_hi)

    # 背景にムラ（グラデーションやノイズ）がある絵だと、四隅から測った距離が
    # 背景全体で 0 にならず、どこも半透明のままになる。抜けた領域の分布を見て
    # 「ここまでは背景」の線を引き直す。均一な背景なら T_LO のまま動かない。
    inside = dist[background]
    t_lo_eff = float(max(t_lo, np.percentile(inside, 80))) if inside.size else t_lo
    t_hi_eff = max(t_hi, t_lo_eff + 12.0)

    alpha = np.full(dist.shape, 255.0, dtype=np.float32)
    ramp = np.clip((dist - t_lo_eff) / (t_hi_eff - t_lo_eff), 0.0, 1.0) * 255.0
    alpha[background] = ramp[background]

    out = np.dstack([rgb, alpha]).astype(np.uint8)
    Image.fromarray(out, mode='RGBA').save(path)

    transparent = float((alpha == 0).mean())
    partial = float(((alpha > 0) & (alpha < 255)).mean())
    return bg, t_lo_eff, transparent, partial


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('files', nargs='+')
    ap.add_argument('--tolerance', type=float, default=T_HI,
                    help='背景とみなす色の距離の上限（既定 34）')
    args = ap.parse_args()

    for name in args.files:
        path = Path(name)
        if not path.exists():
            print(f'skip (not found): {path}')
            continue
        bg, t_lo, transparent, partial = cutout(path, T_LO, args.tolerance)
        print(f'{path.name:22s} bg=({bg[0]:.0f},{bg[1]:.0f},{bg[2]:.0f}) '
              f't_lo={t_lo:5.1f}  clear {transparent * 100:5.1f}%  soft {partial * 100:4.1f}%')


if __name__ == '__main__':
    sys.exit(main())
