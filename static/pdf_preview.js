import { base64Blob, cacheBustedUrl, els, showToast, state } from './state.js';

export async function resolvePdfPreviewUrl(serverUrl, fallbackUrl) {
  if (!serverUrl) return fallbackUrl;
  const previewUrl = cacheBustedUrl(serverUrl);
  try {
    const response = await fetch(previewUrl, { method: 'HEAD', cache: 'no-store' });
    if (response.ok || response.status === 206) return previewUrl;
  } catch {
    // Keep using the server URL below; browser PDF plugins are more reliable with HTTP than Blob.
  }
  return previewUrl;
}

export function armPdfFallback(iframe, fallbackUrl) {
  iframe.dataset.fallbackSrc = fallbackUrl;
  iframe.onerror = () => {
    const fallback = iframe.dataset.fallbackSrc;
    if (fallback && iframe.src !== fallback) {
      iframe.src = fallback;
      showToast('PDF 预览地址失效，已切换到本地缓存');
    }
  };
}

export function showPdfPreviewError() {
  const iframe = document.querySelector('#compiled-pdf');
  const placeholder = document.querySelector('#pdf-placeholder');
  iframe.hidden = true;
  iframe.removeAttribute('src');
  document.querySelector('#pdf-live-preview').classList.remove('ready');
  placeholder.textContent = 'PDF 已生成，但浏览器预览加载失败。请重新点击 PDF 标签或再次编译。';
  showToast('PDF 已生成，但预览加载失败');
}

export function updatePdfActions() {
  const ready = Boolean(state.currentPdf?.url);
  els.pdfDownloadButton.disabled = !ready;
  els.pdfFullscreenButton.disabled = !ready;
}

export function loadPdfPreview(previewUrl, fallbackUrl) {
  const iframe = document.querySelector('#compiled-pdf');
  armPdfFallback(iframe, fallbackUrl);
  iframe.dataset.pendingSrc = '';
  iframe.dataset.pendingFallback = '';
  document.querySelector('#pdf-live-preview').classList.add('ready');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      try {
        iframe.hidden = false;
        iframe.src = previewUrl;
      } catch {
        showPdfPreviewError();
      }
    });
  });
}

export function queuePdfPreview(previewUrl, fallbackUrl) {
  const iframe = document.querySelector('#compiled-pdf');
  iframe.dataset.pendingSrc = previewUrl;
  iframe.dataset.pendingFallback = fallbackUrl;
  document.querySelector('#pdf-live-preview').classList.add('ready');
}

export function flushPendingPdfPreview() {
  const iframe = document.querySelector('#compiled-pdf');
  const pendingSrc = iframe.dataset.pendingSrc;
  if (pendingSrc) loadPdfPreview(pendingSrc, iframe.dataset.pendingFallback || pendingSrc);
}

export function resetPdfPreview() {
  const iframe = document.querySelector('#compiled-pdf');
  const placeholder = document.querySelector('#pdf-placeholder');
  iframe.onerror = null;
  iframe.hidden = true;
  iframe.removeAttribute('src');
  delete iframe.dataset.fallbackSrc;
  delete iframe.dataset.pendingSrc;
  delete iframe.dataset.pendingFallback;
  state.currentPdf = null;
  updatePdfActions();
  placeholder.textContent = '尚未生成 PDF。请先安装本地 LaTeX 工具链，再点击“编译 PDF”。';
  document.querySelector('#pdf-live-preview').classList.remove('ready');
}

export function downloadCurrentPdf() {
  if (!state.currentPdf?.url) { showToast('请先编译生成 PDF'); return; }
  const link = document.createElement('a');
  link.href = state.currentPdf.downloadUrl || state.currentPdf.url;
  link.download = state.currentPdf.name || 'papercraft.pdf';
  link.click();
}

export function pdfZoomUrl(url, zoom = 200) {
  if (!url) return '';
  return url.split('#')[0] + `#zoom=${zoom}`;
}

export async function openCurrentPdfFullscreen() {
  if (!state.currentPdf?.url) { showToast('请先编译生成 PDF'); return; }
  const zoomedUrl = pdfZoomUrl(state.currentPdf.url, 250);
  window.open(zoomedUrl, '_blank', 'noopener');
  showToast('已打开独立 PDF 预览器 · 250%');
}

export function compiledPdfFile(data) {
  return base64Blob(data.pdf, 'application/pdf');
}
