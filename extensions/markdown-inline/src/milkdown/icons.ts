export const ICON_GRIP = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="5.5" cy="3" r="1.2" fill="currentColor"/><circle cx="10.5" cy="3" r="1.2" fill="currentColor"/><circle cx="5.5" cy="8" r="1.2" fill="currentColor"/><circle cx="10.5" cy="8" r="1.2" fill="currentColor"/><circle cx="5.5" cy="13" r="1.2" fill="currentColor"/><circle cx="10.5" cy="13" r="1.2" fill="currentColor"/></svg>`;

export const ICON_CHEVRON_DOWN = `<svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd"/></svg>`;

export const ICON_CHECK = `<svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd"/></svg>`;

export const ICON_COPY = `<svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor"><path d="M7 3.5A1.5 1.5 0 018.5 2h3.879a1.5 1.5 0 011.06.44l3.122 3.12A1.5 1.5 0 0117 6.622V12.5a1.5 1.5 0 01-1.5 1.5h-1v-3.379a3 3 0 00-.879-2.121L10.5 5.379A3 3 0 008.379 4.5H7v-1z"/><path d="M4.5 6A1.5 1.5 0 003 7.5v9A1.5 1.5 0 004.5 18h7a1.5 1.5 0 001.5-1.5v-5.879a1.5 1.5 0 00-.44-1.06L9.44 6.439A1.5 1.5 0 008.378 6H4.5z"/></svg>`;

export const ICON_COPY_SUCCESS = `<svg width="12" height="12" viewBox="0 0 20 20" fill="#22C55E"><path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd"/></svg>`;

export const ICON_TRASH = `<svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clip-rule="evenodd"/></svg>`;

export const ICON_ERASER = `<svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor"><path d="M2.22 2.22a.75.75 0 011.06 0l14.5 14.5a.75.75 0 11-1.06 1.06L2.22 3.28a.75.75 0 010-1.06z"/></svg>`;

const tableIcon = (content: string) =>
  `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><g stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">${content}</g></svg>`;

export const ICON_MOVE_UP = tableIcon(`<path d="M8 12V4M5.25 6.75 8 4l2.75 2.75"/>`);
export const ICON_MOVE_DOWN = tableIcon(`<path d="M8 4v8m-2.75-2.75L8 12l2.75-2.75"/>`);
export const ICON_MOVE_LEFT = tableIcon(`<path d="M12 8H4m2.75-2.75L4 8l2.75 2.75"/>`);
export const ICON_MOVE_RIGHT = tableIcon(`<path d="M4 8h8M9.25 5.25 12 8l-2.75 2.75"/>`);
export const ICON_ADD_ROW_ABOVE = tableIcon(`<rect x="2.25" y="6.25" width="11.5" height="7.5" rx="1"/><path d="M2.25 9.5h11.5M8 1.75v3M6.5 3.25h3"/>`);
export const ICON_ADD_ROW_BELOW = tableIcon(`<rect x="2.25" y="2.25" width="11.5" height="7.5" rx="1"/><path d="M2.25 6h11.5M8 11.25v3M6.5 12.75h3"/>`);
export const ICON_ADD_COLUMN_LEFT = tableIcon(`<rect x="6.25" y="2.25" width="7.5" height="11.5" rx="1"/><path d="M9.5 2.25v11.5M1.75 8h3M3.25 6.5v3"/>`);
export const ICON_ADD_COLUMN_RIGHT = tableIcon(`<rect x="2.25" y="2.25" width="7.5" height="11.5" rx="1"/><path d="M6 2.25v11.5M11.25 8h3M12.75 6.5v3"/>`);
export const ICON_DELETE_ROW = tableIcon(`<rect x="2.25" y="3.25" width="11.5" height="9.5" rx="1"/><path d="M2.25 8h11.5M5.75 5.6l4.5 4.8m0-4.8-4.5 4.8"/>`);
export const ICON_DELETE_COLUMN = tableIcon(`<rect x="3.25" y="2.25" width="9.5" height="11.5" rx="1"/><path d="M8 2.25v11.5M5.6 5.75l4.8 4.5m0-4.5-4.8 4.5"/>`);
