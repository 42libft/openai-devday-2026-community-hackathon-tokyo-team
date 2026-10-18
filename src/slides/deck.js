import { MAX_SLIDES } from './upload.js';
import { createStaticPptxViewer, isExternalRelationship } from './pptx-preview.js';

const makeSteps = count => Array.from({ length: count }, (_, i) => ({ id: `page-${i + 1}`, title: `${i + 1}ページ目`, script: '' }));
function countCheck(count) {
  if (!Number.isInteger(count) || count < 1 || count > MAX_SLIDES) throw new Error('スライドは1〜100枚で読み込んでください。');
}

async function loadPdf(bytes, name, signal) {
  const pdfjs = await import('pdfjs-dist');
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  signal?.throwIfAborted();
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: true,
    maxImageSize: 16 * 1024 * 1024, canvasMaxAreaInBytes: 64 * 1024 * 1024 });
  const abort = () => { void task.destroy(); };
  signal?.addEventListener('abort', abort, { once: true });
  // Password entry is deliberately not retained or sent to a server.
  task.onPassword = () => { void task.destroy(); };
  let pdf;
  try {
    pdf = await task.promise;
    countCheck(pdf.numPages);
    let destroyed = false;
    const deck = {
      kind: 'pdf', name, steps: makeSteps(pdf.numPages),
      async render(index) {
        if (destroyed) throw new Error('Disposed');
        const page = await pdf.getPage(index + 1);
        const natural = page.getViewport({ scale: 1 });
        const scale = Math.min(2, 1600 / Math.max(natural.width, natural.height));
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `${name} ${index + 1}ページ目`);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        return { element: canvas, aspectRatio: viewport.width / viewport.height, dispose() { canvas.width = 0; canvas.height = 0; } };
      },
      destroy() { destroyed = true; signal?.removeEventListener('abort', abort); void task.destroy(); },
    };
    // A damaged first page must not replace a working deck.
    const preview = await deck.render(0); preview.dispose();
    signal?.throwIfAborted();
    signal?.removeEventListener('abort', abort);
    return deck;
  } catch {
    signal?.removeEventListener('abort', abort);
    await task.destroy();
    throw new Error('PDFを読み込めません。パスワードを解除し、100ページ以下で書き出して再試行してください。');
  }
}

/** Block external relationships before building/rendering uploaded OOXML. */
export function stripExternalRelationships(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Invalid relationships');
  for (const rel of [...doc.getElementsByTagNameNS('*', 'Relationship')]) {
    if (isExternalRelationship(rel.getAttribute('Target') ?? '', rel.getAttribute('TargetMode') ?? '')) rel.remove();
  }
  return new XMLSerializer().serializeToString(doc);
}

async function loadPptx(bytes, name, signal) {
  const { parseZip, buildPresentation, PptxViewer, RECOMMENDED_ZIP_LIMITS } = await import('@aiden0z/pptx-renderer');
  signal?.throwIfAborted();
  const files = await parseZip(bytes, { ...RECOMMENDED_ZIP_LIMITS, maxTotalUncompressedBytes: 96 * 1024 * 1024, maxMediaBytes: 64 * 1024 * 1024 });
  signal?.throwIfAborted();
  countCheck(files.slides.size);
  files.presentationRels = stripExternalRelationships(files.presentationRels);
  for (const key of ['slideRels', 'slideLayoutRels', 'slideMasterRels', 'chartRels']) {
    for (const [part, xml] of files[key] ?? []) files[key].set(part, stripExternalRelationships(xml));
  }
  const presentation = buildPresentation(files);
  countCheck(presentation.slides.length);
  const viewers = new Set();
  let destroyed = false;
  const deck = {
    kind: 'pptx', name, steps: makeSteps(presentation.slides.length),
    async render(index) {
      if (destroyed) throw new Error('Disposed');
      const host = document.createElement('div');
      host.className = 'pptx-page';
      host.style.aspectRatio = `${presentation.width} / ${presentation.height}`;
      host.setAttribute('role', 'img'); host.setAttribute('aria-label', `${name} ${index + 1}ページ目`);
      const surface = document.createElement('div');
      surface.className = 'pptx-render-surface'; host.append(surface);
      const viewer = createStaticPptxViewer(surface, PptxViewer);
      const resize = new ResizeObserver(() => { surface.style.transform = `scale(${host.clientWidth / 1200})`; });
      resize.observe(host);
      const dispose = () => { resize.disconnect(); viewer.destroy(); viewers.delete(dispose); };
      viewers.add(dispose);
      try {
        viewer.load(presentation);
        await viewer.renderSlide(index);
        surface.style.position = 'absolute';
        surface.style.transformOrigin = 'top left';
        if (destroyed) { dispose(); throw new Error('Disposed'); }
        return { element: host, aspectRatio: presentation.width / presentation.height, dispose };
      } catch (error) { dispose(); throw error; }
    },
    destroy() { destroyed = true; for (const dispose of [...viewers]) dispose(); },
  };
  try { const preview = await deck.render(0); preview.dispose(); signal?.throwIfAborted(); return deck; }
  catch { deck.destroy(); throw new Error('PPTXを表示できません。PDFへ書き出して再試行してください。'); }
}

export async function loadSlideDeck(file, kind, signal) {
  const bytes = await file.arrayBuffer();
  signal?.throwIfAborted();
  const header = new Uint8Array(bytes, 0, Math.min(8, bytes.byteLength));
  if (kind === 'pdf' && new TextDecoder().decode(header).startsWith('%PDF-')) return loadPdf(bytes, file.name, signal);
  if (kind === 'pptx' && header[0] === 0x50 && header[1] === 0x4b) {
    try { return await loadPptx(bytes, file.name, signal); }
    catch { throw new Error('PPTXを読み込めません。破損・パスワード・容量を確認するか、PDFへ書き出して再試行してください。'); }
  }
  throw new Error('ファイルの内容が形式と一致しません。PDFまたはPPTXを選び直してください。');
}
