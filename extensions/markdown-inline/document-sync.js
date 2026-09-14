const { isInlineTheme } = require("./themes");
function parseEditorMessage(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  if (value.type === "resolveImage" && typeof value.src === "string" && value.src.length <= 5_000_000 &&
      typeof value.requestId === "string" && value.requestId.length > 0 && value.requestId.length <= 128) {
    return {type: "resolveImage", src: value.src, requestId: value.requestId};
  }
  if (value.type === "copyCode" && typeof value.text === "string" &&
      typeof value.requestId === "string" && value.requestId.length > 0 && value.requestId.length <= 128) {
    return { type: "copyCode", text: value.text, requestId: value.requestId };
  }
  if (
    value.type === "copyDocument" ||
    value.type === "copyPath" ||
    value.type === "copyFolderPath" ||
    value.type === "save" ||
    value.type === "improveText" ||
    value.type === "undo" ||
    value.type === "redo"
  ) {
    return { type: value.type, ...(
      ["copyDocument", "copyPath", "copyFolderPath"].includes(value.type) &&
      typeof value.requestId === "string" && value.requestId.length > 0 && value.requestId.length <= 128
        ? { requestId: value.requestId } : {}
    ) };
  }
  if (value.type === "openRaw") {
    return { type: "openRaw", ...(Number.isSafeInteger(value.offset) && value.offset >= 0 ? {offset: value.offset} : {}) };
  }
  if (value.type === "pastePlainText") return {type: "pastePlainText"};
  if (value.type === "setReadingPreference" && (
    value.key === "fontSize" && Number.isInteger(value.value) && value.value >= 10 && value.value <= 36 ||
    value.key === "contentWidth" && ["normal", "large", "full"].includes(value.value) ||
    value.key === "codeWrap" && typeof value.value === "boolean"
  )) return {type: "setReadingPreference", key: value.key, value: value.value};
  if (value.type === "flushComplete" && typeof value.flushId === "string" && value.flushId.length <= 128) {
    return { type: "flushComplete", flushId: value.flushId, ...(typeof value.error === "string" ? {error: value.error} : {}) };
  }
  if (value.type === "saveBlocked") return {type: "saveBlocked"};
  if (value.type === "ready" && typeof value.session === "string" && value.session.length <= 128) {
    return { type: "ready", session: value.session };
  }
  if (value.type === "retainDraft" && (value.draft === null ||
    (typeof value.draft?.text === "string" && typeof value.draft.baseText === "string"))) {
    return { type: "retainDraft", draft: value.draft === null ? null : {
      text: value.draft.text, baseText: value.draft.baseText, conflicted: value.draft.conflicted === true,
      ...(typeof value.draft.sourceError === "string" ? {sourceError: value.draft.sourceError} : {})
    } };
  }
  if (
    value.type === "setTheme" &&
    isInlineTheme(value.theme)
  ) {
    return { type: "setTheme", theme: value.theme };
  }
  if (value.type === "openLink" && typeof value.href === "string" && value.href.length <= 8192) {
    return { type: "openLink", href: value.href };
  }
  if (value.type === "openExternal" && typeof value.href === "string") {
    try {
      const url = new URL(value.href);
      if (["http:", "https:", "mailto:"].includes(url.protocol)) {
        return { type: "openExternal", href: url.href };
      }
    } catch {}
    return null;
  }
  if (
    ["edit", "restoreDraft"].includes(value.type) &&
    Number.isSafeInteger(value.version) &&
    value.version >= 0 &&
    typeof value.text === "string" &&
    typeof value.requestId === "string" && value.requestId.length > 0 && value.requestId.length <= 128
  ) {
    return { type: value.type, requestId: value.requestId, version: value.version, text: value.text };
  }
  if (["compareDraft", "discardDraft"].includes(value.type) && typeof value.text === "string") {
    return { type: value.type, text: value.text };
  }
  return null;
}

function documentPayload(document) {
  return {
    type: "update",
    version: document.version,
    text: document.getText(),
    dirty: Boolean(document.isDirty)
  };
}

function shouldApplyDocumentEdit(documentText, editorText) {
  return documentText !== editorText;
}

class DocumentQueue {
  constructor() { this.pending = Promise.resolve(); }
  run(operation) {
    const result = this.pending.then(operation);
    this.pending = result.catch(() => {});
    return result;
  }
}

async function applyDocumentRequest(document, message, apply) {
  const result = (status, error) => ({ ...documentPayload(document), type: "editResult",
    requestId: message.requestId, status, ...(error ? { error } : {}) });
  if (message.version !== document.version) return result("conflict", "The file changed. Compare your retained draft with the file.");
  if (!shouldApplyDocumentEdit(document.getText(), message.text)) return result("applied");
  try {
    if (!await apply(message.text)) return result("error", "VS Code rejected the edit. Your draft is retained.");
    if (document.getText() !== message.text) return result("conflict", "The file changed during synchronization. Your draft is retained.");
    return result("applied");
  } catch (error) {
    return result("error", `Could not apply the edit: ${error instanceof Error ? error.message : String(error)}`);
  }
}

module.exports = {
  DocumentQueue,
  applyDocumentRequest,
  documentPayload,
  parseEditorMessage,
  shouldApplyDocumentEdit
};
