// A paragraph holding only `---`, `___` or `***` becomes a horizontal rule on Enter,
// and the caret moves to a new line below. The dashes stay plain text while typing,
// so no keystroke before Enter changes the layout.
import { hrSchema, paragraphSchema } from '@milkdown/kit/preset/commonmark';
import { Fragment } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

const MARKER = /^(?:---|___|\*\*\*)[ \t]*$/;

export const hrOnEnter = $prose(
  (ctx) =>
    new Plugin({
      key: new PluginKey('hr-on-enter'),
      props: {
        handleKeyDown(view, event) {
          if (
            event.key !== 'Enter' ||
            event.shiftKey ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.isComposing ||
            view.composing
          )
            return false;
          const { selection } = view.state;
          const { $from } = selection;
          const paragraph = $from.parent;
          if (
            !(selection instanceof TextSelection) ||
            !selection.empty ||
            paragraph.type !== paragraphSchema.type(ctx) ||
            $from.parentOffset !== paragraph.content.size ||
            !MARKER.test(paragraph.textContent)
          )
            return false;
          const hr = hrSchema.type(ctx).create();
          const index = $from.index(-1);
          const content = Fragment.from([hr, paragraph.type.create()]);
          if (!$from.node(-1).canReplace(index, index + 1, content)) return false;
          const from = $from.before();
          const tr = view.state.tr.replaceWith(from, $from.after(), content);
          view.dispatch(
            tr.setSelection(TextSelection.create(tr.doc, from + hr.nodeSize + 1)).scrollIntoView(),
          );
          return true;
        },
      },
    }),
);
