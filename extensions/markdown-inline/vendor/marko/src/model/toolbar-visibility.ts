export function shouldShowTableToolbar({editable, inTable, linkAtCursor}: { editable: boolean; inTable: boolean; linkAtCursor: boolean }) {
  return editable && inTable && !linkAtCursor;
}

export function tableToolbarActionMode(rowIndex: number) {
  return rowIndex === 0 ? "column" : "row";
}
