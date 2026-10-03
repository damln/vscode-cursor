export * from "../../vendor/marko/src/plugins/floating-panel";

export function hideOnViewportChange(hide: () => void) {
  window.addEventListener('resize', hide);
  window.addEventListener('blur', hide);
  document.getElementById('document-scroll')?.addEventListener('scroll', hide, {passive: true});
}
