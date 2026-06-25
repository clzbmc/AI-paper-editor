import { base64Blob, cacheBustedUrl, els, showToast, state } from './state.js?v=20260625-memory-collapse';
import { uiText } from './ui_language.js?v=20260625-memory-collapse';

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
      showToast(uiText('toast.pdfFallback'));
    }
  };
}

export function showPdfPreviewError() {
  const iframe = document.querySelector('#compiled-pdf');
  const placeholder = document.querySelector('#pdf-placeholder');
  iframe.hidden = true;
  iframe.removeAttribute('src');
  document.querySelector('#pdf-live-preview').classList.remove('ready');
  placeholder.textContent = uiText('pdf.previewFailed');
  showToast(uiText('toast.pdfPreviewFailed'));
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
  placeholder.textContent = uiText('pdf.placeholder');
  document.querySelector('#pdf-live-preview').classList.remove('ready');
}

export function downloadCurrentPdf() {
  if (!state.currentPdf?.url) { showToast(uiText('toast.compilePdfFirst')); return; }
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
  if (!state.currentPdf?.url) { showToast(uiText('toast.compilePdfFirst')); return; }
  const zoomedUrl = pdfZoomUrl(state.currentPdf.url, 250);
  window.open(zoomedUrl, '_blank', 'noopener');
  showToast(uiText('toast.pdfFullscreenOpened'));
}

export function compiledPdfFile(data) {
  return base64Blob(data.pdf, 'application/pdf');
}
