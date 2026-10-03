import { $view } from "@milkdown/kit/utils";
import { htmlSchema } from "@milkdown/kit/preset/commonmark";
import { disableAutocorrect } from "../model/autocorrect";

function getHtmlEditableClass(value: string): string {
  if (/^<br\s*\/?>$/i.test(value)) return "html-editable br-marker";
  if (value.startsWith("<!--")) return "html-editable";
  return "html-editable liquid-tag-inline";
}

export const htmlEditableView = $view(htmlSchema.node, () => {
  return (node: any, view: any, getPos: any) => {
    const value = node.attrs.value || "";
    const isBrMarker = /^<br\s*\/?>$/i.test(value);
    const displayValue = value;

    const span = document.createElement("span");
    span.className = getHtmlEditableClass(value);
    span.contentEditable = "false";
    span.tabIndex = isBrMarker ? -1 : 0;
    disableAutocorrect(span);
    span.textContent = displayValue;

    function commit() {
      if (isBrMarker || !view.editable) return;
      const pos = getPos();
      if (pos == null) return;
      const newValue = span.textContent || "";
      if (newValue !== node.attrs.value) {
        const tr = view.state.tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          value: newValue,
        });
        view.dispatch(tr);
      }
    }

    span.addEventListener("focus", () => {
      if (view.editable && !isBrMarker) span.contentEditable = "true";
    });
    span.addEventListener("beforeinput", event => { if (!view.editable) event.preventDefault(); });
    span.addEventListener("input", commit);
    span.addEventListener("blur", () => {
      commit();
      span.contentEditable = "false";
    });
    span.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        span.blur();
      }
    });

    return {
      dom: span,
      stopEvent: (e: Event) => {
        return span.contains(e.target as Node);
      },
      ignoreMutation: () => true,
      update: (updatedNode: any) => {
        if (updatedNode.type.name !== node.type.name) return false;
        const newVal = updatedNode.attrs.value || "";
        const newDisplay = newVal;
        span.className = getHtmlEditableClass(newVal);
        if (span.textContent !== newDisplay) {
          span.textContent = newDisplay;
        }
        node = updatedNode;
        return true;
      },
    };
  };
});
