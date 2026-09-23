document.addEventListener('DOMContentLoaded', async () => {
  const result = document.querySelector('#scan-result');
  const scanMore = document.querySelector('#scan-more-product');
  const cameraCapture = document.querySelector('#camera-capture');
  const token = decodeURIComponent(window.location.pathname.split('/').filter(Boolean)
  .pop() || '');
  cameraCapture.addEventListener('change', async () => {
    const file = cameraCapture.files?.[0];
    if (!file) {
      scanMore.hidden = false;
      return;
    }
    scanMore.hidden = true;
    result.textContent = 'Reading QR picture… / 正在识别二维码…';
    result.className = 'scan-result';
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg',
        0.82));
      const form = new FormData();
      form.append('image', blob, 'qr-scan.jpg');
      const response = await fetch('/api/inventory/decode-qr', {
        method: 'POST',
        body: form
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'QR code could not be read.');
      window.location.replace(data.scan_path);
    } catch (error) {
      result.textContent = `${error.message} / 请重新拍摄清晰的二维码。`;
      result.classList.add('scan-warning');
      scanMore.hidden = false;
    } finally {
      cameraCapture.value = '';
    }
  });
  try {
    const response = await fetch(`/api/inventory/scan/${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: '{}',
    });
    const data = await response.json();
    result.textContent = data.message || data.error || 'Inventory response received.';
    result.classList.add(response.ok ? 'scan-success' : 'scan-warning');
  } catch (_error) {
    result.textContent =
      'Unable to reach the inventory server. Confirm this phone is on the factory Wi-Fi and try again. / 无法连接库存服务器，请确认手机已连接工厂 Wi-Fi。';
    result.classList.add('scan-warning');
  } finally {
    scanMore.hidden = false;
  }
});
