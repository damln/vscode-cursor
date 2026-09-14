import { findHexColors } from '../../color-preview';

export function updateMetadataColors(container: HTMLElement, input: HTMLTextAreaElement, labels = false) {
  container.replaceChildren();
  const seen = new Set<string>();
  for (const {color, from, to} of findHexColors(input.value)) {
    if (seen.has(color)) continue;
    seen.add(color);
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'metadata-color';
    button.setAttribute('aria-label', `Select ${color} in ${input.getAttribute('aria-label') || 'value'}`);
    button.dataset.toolbarHint = `${color} · Select color value`;
    const chip = document.createElement('span'); chip.className = 'metadata-color-chip'; chip.setAttribute('aria-hidden', 'true');
    chip.style.setProperty('--metadata-color', color); button.append(chip);
    if (labels) { const label = document.createElement('span'); label.textContent = color; button.append(label); }
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', () => { input.focus(); input.setSelectionRange(from, to); });
    container.append(button);
  }
  container.hidden = labels && !seen.size;
}
