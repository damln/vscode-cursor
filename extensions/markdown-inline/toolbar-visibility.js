function shouldShowTableToolbar({ editable, inTable, linkAtCursor }) {
  return Boolean(editable && inTable && !linkAtCursor);
}

function tableToolbarActionMode(rowIndex) {
  return rowIndex === 0 ? "column" : "row";
}

module.exports = { shouldShowTableToolbar, tableToolbarActionMode };
