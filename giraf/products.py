"""Names and private copies for user-facing execution products."""
import hashlib
from pathlib import Path
import shutil
import unicodedata


def product_name(value, asset=None):
    name = str(value)
    if (not name.strip() or name in ('.', '..') or any(c in name for c in '/\\')
            or any(unicodedata.category(c) == 'Cc' for c in name)):
        raise ValueError('경로 구분자나 제어문자 없이 결과 파일 이름을 입력해 주세요.')
    if asset == 'image' and not Path(name).suffix:
        name += '.fits'
    return name


def publish_product(job, product, number):
    """Copy an internal output without changing its execution path or metadata."""
    label = product_name(product['label'], product.get('asset'))
    relative = Path('products') / str(number) / label
    target = Path(job) / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(Path(job) / product['file'], target)
    with target.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    return dict(product, file=str(relative), label=label, sha256=digest)
