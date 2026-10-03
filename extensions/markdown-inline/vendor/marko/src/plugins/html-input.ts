import { $inputRule, $prose } from '@milkdown/kit/utils';
import { htmlSchema } from '@milkdown/kit/preset/commonmark';
import { InputRule } from '@milkdown/kit/prose/inputrules';
import { Plugin, PluginKey, type EditorState } from '@milkdown/kit/prose/state';
import type { NodeType } from '@milkdown/kit/prose/model';
import { HTML_TAG_PATTERN } from '../model/html';

const TAG = new RegExp(HTML_TAG_PATTERN + '$');

function replaceTag(state: EditorState, match: RegExpMatchArray, start: number, end: number, type: NodeType) {
  const $start = state.doc.resolve(start);
  if ($start.parent.type.spec.code) return null;
  const before = $start.parent.textBetween(0, $start.parentOffset, '', '\ufffc');
  if ((before.match(/\\+$/)?.[0].length ?? 0) % 2) return null;
  const marks = state.storedMarks ?? $start.marks();
  if (marks.some(mark => mark.type.spec.code)) return null;
  let code = false;
  state.doc.nodesBetween(start, end, node => { if (node.marks.some(mark => mark.type.spec.code)) code = true; });
  if (code) return null;
  const tag = type.create({value: match[0]}, null, marks);
  return state.tr.replaceWith(start, end, tag);
}

export const htmlTagInputRule = $inputRule(ctx => new InputRule(TAG,
  (state, match, start, end) => replaceTag(state, match, start, end, htmlSchema.type(ctx)), {inCodeMark: false}));

function followsTag(state: EditorState, position: number): boolean {
  const $from = state.doc.resolve(position);
  const {node, index} = $from.parent.childBefore($from.parentOffset);
  return Boolean(node?.type.name === 'html' || node?.isText && index > 0 && $from.parent.child(index - 1).type.name === 'html');
}

export const htmlBoundaryInput = $prose(ctx => new Plugin({
  key: new PluginKey('html-boundary-input'),
  props: {
    handleKeyDown(view, event) {
      if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey || view.composing ||
          !followsTag(view.state, view.state.selection.from)) return false;
      const {from, to} = view.state.selection;
      const insert = () => view.state.tr.insertText(event.key, from, to).scrollIntoView();
      if (!view.someProp('handleTextInput', handler => handler(view, from, to, event.key, insert))) view.dispatch(insert());
      return true;
    },
    handleTextInput(view, from, to, text) {
      const $from = view.state.doc.resolve(from);
      if (text.endsWith('>')) {
        // Input rules inspect at most 500 characters; long attribute values also work.
        const match = ($from.parent.textBetween(0, $from.parentOffset, '', '\ufffc') + text).match(TAG);
        if (!match || match[0].length < text.length) return false;
        const tr = replaceTag(view.state, match, from - match[0].length + text.length, to, htmlSchema.type(ctx));
        if (!tr) return false;
        view.dispatch(tr);
        return true;
      }
      if (/[\r\n]/.test(text)) return false;
      if (!followsTag(view.state, from)) return false;
      // Preserve typed spaces when native DOM parsing resumes beside an atom.
      view.dispatch(view.state.tr.insertText(text, from, to));
      return true;
    },
  },
}));
