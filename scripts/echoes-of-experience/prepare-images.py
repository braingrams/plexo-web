"""Prepares the site's images from the user's originals. Usage: python3 prepare-images.py <assets dir> [<mockup dir>]
Reads hero.png, cta-banner.png, logo.jpg, footer-leaf.png, raw-tea.jpg (Unsplash stand-in) from the assets dir and the
user's reference photos 2.png/3.png (Facebook post + books photo) from the mockup dir; writes <assets dir>/out/*."""
import os, sys
from PIL import Image, ImageFilter

A = sys.argv[1]
M = sys.argv[2] if len(sys.argv) > 2 else A
O = os.path.join(A, "out"); os.makedirs(O, exist_ok=True)
CREAM = (248, 241, 232)

def save_jpg(im, name, q=82):
    im.convert("RGB").save(os.path.join(O, name), "JPEG", quality=q, optimize=True, progressive=True)

def fit_width(im, w):
    return im.resize((w, round(im.height * w / im.width)), Image.LANCZOS) if im.width > w else im

# Hero: the user's photo exactly as supplied. The cream fade on the left is a gradient laid over it on the page
# (design.ts), so replacing the photo in the editor keeps the fade.
save_jpg(fit_width(Image.open(os.path.join(A, "hero.png")).convert("RGB"), 1800), "hero-bg.jpg", 82)

save_jpg(fit_width(Image.open(os.path.join(A, "hero.png")).convert("RGB"), 900), "hero-mobile.jpg", 80)  # phones: the photo on its own, below the text

# CTA banner: a soft cream wash behind the centred text (an ellipse), so it reads like the mockup.
cta = fit_width(Image.open(os.path.join(A, "cta-banner.png")).convert("RGB"), 2000)
W, H = cta.size
# the mockup's band is hazy: a light blur and cream wash over everything except the crisp leaves on the far left
haze = cta.filter(ImageFilter.GaussianBlur(3.2))
ramp = Image.new("L", (W, H)); rp = ramp.load()
for x in range(W):
    t = min(1.0, max(0.0, (x / W - 0.10) / 0.16)); v = int(255 * t)
    for y in range(H): rp[x, y] = v
cta = Image.composite(haze, cta, ramp)
cta = Image.composite(Image.new("RGB", (W, H), CREAM), cta, ramp.point(lambda v: int(v * 0.42)))
wash = Image.new("L", (W, H), 0)
wp = wash.load()
for y in range(H):
    for x in range(W):
        dx = (x - W / 2) / (W * 0.30); dy = (y - H / 2) / (H * 0.80)
        d = (dx * dx + dy * dy) ** 0.5
        wp[x, y] = int(255 * 0.90 * max(0.0, 1 - d) ** 0.55)
wash = wash.filter(ImageFilter.GaussianBlur(24))
save_jpg(Image.composite(Image.new("RGB", (W, H), CREAM), cta, wash), "cta-bg.jpg", 80)

# Latest-video thumbnail and blog image 1: crops of the user's own reference photos.
save_jpg(Image.open(os.path.join(M, "2.png")).convert("RGB").crop((0, 470, 720, 770)), "video-thumb.jpg", 85)
save_jpg(Image.open(os.path.join(M, "3.png")).convert("RGB").crop((170, 810, 720, 1081)), "blog-1.jpg", 85)

# Blog image 2: the Unsplash tea photo, cropped wide.
tea = Image.open(os.path.join(A, "raw-tea.jpg")).convert("RGB")
save_jpg(tea.crop((0, 150, tea.width, 150 + int(tea.width * 0.6))), "blog-2.jpg", 82)

# Logo: the cream background becomes transparent (a multiply-style unmix), so it sits on any cream page without a box.
logo = Image.open(os.path.join(A, "logo.jpg")).convert("RGB")
bg = (253, 246, 230)
src = logo.load()
out = Image.new("RGBA", logo.size); op = out.load()
for y in range(logo.height):
    for x in range(logo.width):
        r, g, b = src[x, y]
        a = 1 - min(r / bg[0], g / bg[1], b / bg[2])
        a = 0.0 if a < 0.03 else min(1.0, a * 1.02)
        if a == 0:
            op[x, y] = (0, 0, 0, 0)
        else:
            op[x, y] = tuple(max(0, min(255, round((c - bgc * (1 - a)) / a))) for c, bgc in zip((r, g, b), bg)) + (round(a * 255),)
out.resize((620, 620), Image.LANCZOS).save(os.path.join(O, "logo.png"), optimize=True)
# Blog image 3 ("A Life of Resilience"): the user's own photo of the man on the bench.
res = Image.open(os.path.join(A, "blog-resilience.png")).convert("RGB")
save_jpg(fit_width(res, 1000), "blog-3.jpg", 82)
logo.crop((60, 60, 1194, 1194)).resize((256, 256), Image.LANCZOS).save(os.path.join(O, "favicon.png"))
og = Image.new("RGB", (1200, 630), (253, 246, 230)); og.paste(logo.resize((630, 630), Image.LANCZOS), (285, 0)); save_jpg(og, "og.jpg", 88)

# The leaf: its pale background becomes transparent (same unmix as the logo), so it shows no box on the cream footer.
leaf = Image.open(os.path.join(A, "footer-leaf.png")).convert("RGBA")
lp = leaf.load(); lbg = leaf.getpixel((3, 3))[:3]
# The supplied crop has a thin dark line baked into its top and right edges (a screenshot border): clear them.
for y in range(leaf.height):
    for x in range(leaf.width):
        if y < 3 or x >= leaf.width - 3:
            lp[x, y] = (*lbg, 255)
for y in range(leaf.height):
    for x in range(leaf.width):
        r, g, b, _ = lp[x, y]
        a = 1 - min(r / lbg[0], g / lbg[1], b / lbg[2])
        a = 0.0 if a < 0.04 else min(1.0, a * 1.05)
        lp[x, y] = (0, 0, 0, 0) if a == 0 else tuple(max(0, min(255, round((c - bc * (1 - a)) / a))) for c, bc in zip((r, g, b), lbg)) + (round(a * 255),)
leaf.save(os.path.join(O, "footer-leaf.png"), optimize=True)
print("ok", sorted(os.listdir(O)))
