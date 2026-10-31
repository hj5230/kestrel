# Generate platform icons from the supplied illustration. macOS needs a rounded tile with transparent
# margins; iOS needs opaque, square artwork because SpringBoard supplies the corner mask.
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "app-icon-artwork.webp"
RESAMPLE = Image.Resampling.LANCZOS


def save_square(image, path, size):
    image.resize((size, size), RESAMPLE).save(path)


def main():
    artwork = Image.open(SOURCE).convert("RGB")
    if artwork.width != artwork.height:
        raise ValueError("The illustration must be square; do not silently crop the bird")
    # Keep the original composition: the crown and beak already have generous breathing room.
    ios = artwork.resize((1024, 1024), RESAMPLE)
    ios.save(ROOT / "app-icon-ios.png")

    # Same footprint as the previous Mac icon, with supersampled, antialiased corners.
    scale = 4
    tile_size = 824
    mask = Image.new("L", (tile_size * scale, tile_size * scale))
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, tile_size * scale - 1, tile_size * scale - 1), radius=190 * scale, fill=255
    )
    tile = artwork.resize((tile_size * scale, tile_size * scale), RESAMPLE).convert("RGBA")
    tile.putalpha(mask)
    desktop = Image.new("RGBA", (1024 * scale, 1024 * scale))
    desktop.paste(tile, (100 * scale, 100 * scale))
    desktop = desktop.resize((1024, 1024), RESAMPLE)
    desktop.save(ROOT / "app-icon.png")

    # Use Tauri's platform encoders, but only replace the icon files this repository already uses.
    icons = ROOT / "src-tauri/icons"
    with tempfile.TemporaryDirectory(prefix="kestrel-icons-") as tmp:
        subprocess.run(
            [str(ROOT / "node_modules/.bin/tauri"), "icon", str(ROOT / "app-icon.png"), "-o", tmp],
            cwd=ROOT, check=True,
        )
        for existing in icons.iterdir():
            generated = Path(tmp) / existing.name
            if existing.is_file() and generated.is_file():
                shutil.copyfile(generated, existing)

    # Xcode's asset manifest is authoritative; do not replace it with a generator's naming scheme.
    asset = ROOT / "src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset"
    manifest = json.loads((asset / "Contents.json").read_text())
    for entry in manifest["images"]:
        if "filename" not in entry:
            continue
        points = float(entry["size"].split("x")[0])
        factor = float(entry.get("scale", "1x").removesuffix("x"))
        save_square(ios, asset / entry["filename"], round(points * factor))

    # Browser favicon uses the same composition, with corners baked in but no Dock margins.
    favicon = ios.convert("RGBA")
    mask = Image.new("L", (1024, 1024))
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, 1023, 1023), radius=236, fill=255)
    favicon.putalpha(mask)
    save_square(favicon, ROOT / "public/favicon.png", 64)
    print("Icons generated: desktop, iOS and browser")


if __name__ == "__main__":
    main()
