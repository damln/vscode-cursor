export const ICON_GRIP = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="5.5" cy="3" r="1.2" fill="currentColor"/><circle cx="10.5" cy="3" r="1.2" fill="currentColor"/><circle cx="5.5" cy="8" r="1.2" fill="currentColor"/><circle cx="10.5" cy="8" r="1.2" fill="currentColor"/><circle cx="5.5" cy="13" r="1.2" fill="currentColor"/><circle cx="10.5" cy="13" r="1.2" fill="currentColor"/></svg>`;

export const ICON_CHEVRON_DOWN = `<svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd"/></svg>`;

export const ICON_CHECK = `<svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd"/></svg>`;

const lineIcon = (content: string) =>
  `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><g stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">${content}</g></svg>`;

export const ICON_MOVE_UP = lineIcon(`<path d="M8 12V4M5.25 6.75 8 4l2.75 2.75"/>`);
export const ICON_MOVE_DOWN = lineIcon(`<path d="M8 4v8m-2.75-2.75L8 12l2.75-2.75"/>`);
export const ICON_MOVE_LEFT = lineIcon(`<path d="M12 8H4m2.75-2.75L4 8l2.75 2.75"/>`);
export const ICON_MOVE_RIGHT = lineIcon(`<path d="M4 8h8M9.25 5.25 12 8l-2.75 2.75"/>`);
export const ICON_ADD_ROW_ABOVE = lineIcon(`<rect x="2.25" y="6.25" width="11.5" height="7.5" rx="1"/><path d="M2.25 9.5h11.5M8 1.75v3M6.5 3.25h3"/>`);
export const ICON_ADD_ROW_BELOW = lineIcon(`<rect x="2.25" y="2.25" width="11.5" height="7.5" rx="1"/><path d="M2.25 6h11.5M8 11.25v3M6.5 12.75h3"/>`);
export const ICON_ADD_COLUMN_LEFT = lineIcon(`<rect x="6.25" y="2.25" width="7.5" height="11.5" rx="1"/><path d="M9.5 2.25v11.5M1.75 8h3M3.25 6.5v3"/>`);
export const ICON_ADD_COLUMN_RIGHT = lineIcon(`<rect x="2.25" y="2.25" width="7.5" height="11.5" rx="1"/><path d="M6 2.25v11.5M11.25 8h3M12.75 6.5v3"/>`);
export const ICON_DELETE_ROW = lineIcon(`<rect x="2.25" y="3.25" width="11.5" height="9.5" rx="1"/><path d="M2.25 8h11.5M5.75 5.6l4.5 4.8m0-4.8-4.5 4.8"/>`);
export const ICON_DELETE_COLUMN = lineIcon(`<rect x="3.25" y="2.25" width="9.5" height="11.5" rx="1"/><path d="M8 2.25v11.5M5.6 5.75l4.8 4.5m0-4.5-4.8 4.5"/>`);

export const ICON_COPY = lineIcon(`<rect x="5.25" y="5.25" width="8.5" height="8.5" rx="1.75"/><path d="M10.75 5.25v-1.5a1.5 1.5 0 0 0-1.5-1.5h-5.5a1.5 1.5 0 0 0-1.5 1.5v5.5a1.5 1.5 0 0 0 1.5 1.5h1.5"/>`);
export const ICON_COPY_SUCCESS = lineIcon(`<path d="M3.25 8.5 6.5 11.75l6.25-7.5"/>`);
export const ICON_COPY_ERROR = lineIcon(`<circle cx="8" cy="8" r="6"/><path d="M8 5v3.5M8 11h.01"/>`);
export const ICON_SPINNER = lineIcon(`<path d="M8 2a6 6 0 1 1-6 6"/>`).replace("<svg ", '<svg class="code-copy-spinner" ');
export const ICON_ERASER = lineIcon(`<path d="m4.67 14-2.87-2.87a1.6 1.6 0 0 1 0-2.27l6.4-6.4a1.6 1.6 0 0 1 2.27 0l3.73 3.73a1.6 1.6 0 0 1 0 2.27L8.67 14M14.67 14H4.67M3.33 7.33l6 6"/>`);
export const ICON_TRASH = lineIcon(`<path d="M2.25 4h11.5M12.5 4v9a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 13V4M5.5 4V2.75c0-.69.56-1.25 1.25-1.25h2.5c.69 0 1.25.56 1.25 1.25V4M6.75 7v4.5M9.25 7v4.5"/>`);
