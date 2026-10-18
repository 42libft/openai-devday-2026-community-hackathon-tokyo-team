/** Match the renderer's normalization before permitting any relationship. */
export function isExternalRelationship(target = '', targetMode = '') {
  return targetMode.trim().toLowerCase() === 'external'
    || /^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(target.trim());
}

/** Keep embedded links from navigating independently of presentation state. */
export function createStaticPptxViewer(surface, Viewer) {
  const blockActivation = event => {
    if (event.type === 'keydown' && !['Enter', ' ', 'Spacebar'].includes(event.key)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  surface.addEventListener('click', blockActivation, true);
  surface.addEventListener('keydown', blockActivation, true);
  const unlock = () => {
    surface.removeEventListener('click', blockActivation, true);
    surface.removeEventListener('keydown', blockActivation, true);
  };
  let failed = false, renderError;
  let viewer;
  try {
    viewer = new Viewer(surface, {
      width: 1200, fitMode: 'contain', pdfjs: false,
      onSlideError(_index, error) { failed = true; renderError = error; },
    });
  } catch (error) { unlock(); throw error; }
  return {
    load(presentation) { viewer.load(presentation); },
    async renderSlide(index) {
      failed = false; renderError = undefined;
      await viewer.renderSlide(index);
      // PptxViewer reports slide errors through its callback and resolves.
      if (failed) throw renderError ?? new Error('PPTXのページを表示できません。');
    },
    destroy() { unlock(); viewer.destroy(); },
  };
}
