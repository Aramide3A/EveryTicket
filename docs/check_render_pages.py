from pathlib import Path
import re
import sys

from PIL import Image, ImageChops

root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('/private/tmp/everyticket-backend-guide-render-v3')
files = sorted(root.glob('page-*.png'), key=lambda p: int(re.search(r'(\d+)', p.stem).group()))
for path in files:
    image = Image.open(path).convert('RGB')
    diff = ImageChops.difference(image, Image.new('RGB', image.size, 'white'))
    bbox = diff.getbbox()
    # Measure ink in the body only, excluding repeating header and footer.
    body = image.crop((0, 120, image.width, image.height - 120))
    body_diff = ImageChops.difference(body, Image.new('RGB', body.size, 'white'))
    body_bbox = body_diff.getbbox()
    print(path.name, 'page_bbox=', bbox, 'body_bbox=', body_bbox)
