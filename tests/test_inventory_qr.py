from PIL import Image
import zxingcpp

from app.services.inventory import inventory_scan_url, make_qr_png


def test_inventory_qr_survives_phone_sized_rendering():
    scan_url = (
        "https://slurry-management.local/inventory/scan/"
        "12345678-1234-5678-1234-567812345678?department=slitting"
    )
    image = Image.open(make_qr_png(scan_url)).convert("RGB")
    image.thumbnail((420, 420), Image.Resampling.LANCZOS)
    decoded = zxingcpp.read_barcode(image)

    assert decoded is not None
    assert decoded.text == scan_url


def test_inventory_url_uses_https_behind_secure_gateway():
    assert inventory_scan_url(
        "http://slurry-management.local",
        "roll-token",
        "slitting",
        secure_proxy=True,
    ) == "https://slurry-management.local/inventory/scan/roll-token?department=slitting"


def test_inventory_url_stays_http_on_certificate_free_display_listener():
    assert inventory_scan_url(
        "http://172.23.19.139:5000",
        "roll-token",
        "slitting",
        secure_proxy=False,
    ) == "http://172.23.19.139:5000/inventory/scan/roll-token?department=slitting"
