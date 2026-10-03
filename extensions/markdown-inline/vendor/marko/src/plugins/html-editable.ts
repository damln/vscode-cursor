import { $view } from "@milkdown/kit/utils";
import { htmlSchema } from "@milkdown/kit/preset/commonmark";
import { TextSelection } from '@milkdown/kit/prose/state';
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
    const wrapper = document.createElement('span');
    wrapper.contentEditable = 'false';
    wrapper.append(span);
    span.className = getHtmlEditableClass(value);
    span.contentEditable = "false";
    span.tabIndex = isBrMarker ? -1 : 0;
    disableAutocorrect(span);
    span.textContent = displayValue;
    span.addEventListener('mousedown', event => {
      if (event.button !== 0 || !view.editable || isBrMarker || span.contentEditable === 'true') return;
      event.preventDefault();
      span.contentEditable = 'true';
      span.focus();
    });

    function commit() {
      if (isBrMarker || !view.editable) return;
      const pos = getPos();
      if (pos == null) return;
      const newValue = span.textContent || "";
      if (!newValue) {
        view.dispatch(view.state.tr.delete(pos, pos + node.nodeSize));
        view.focus();
        return;
      }
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
        const pos = getPos();
        if (pos != null && view.editable) {
          view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos + node.nodeSize))));
          view.focus();
        }
      }
    });

    return {
      dom: wrapper,
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
