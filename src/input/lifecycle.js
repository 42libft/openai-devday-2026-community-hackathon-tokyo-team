export function bindInputLifecycle({ window, document, inputs }) {
  const onPageHide = (event) => {
    // Cached pages retain these input instances; stop keeps explicit restart possible.
    for (const input of inputs) {
      if (event.persisted) input.stop();
      else input.dispose();
    }
  };
  const onVisibilityChange = () => {
    if (document.hidden) for (const input of inputs) input.stop();
  };
  window.addEventListener('pagehide', onPageHide);
  document.addEventListener('visibilitychange', onVisibilityChange);
  return () => {
    window.removeEventListener('pagehide', onPageHide);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
