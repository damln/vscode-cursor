import { getEditorPlugins as sharedPlugins, configureEditor as sharedConfig } from '../../vendor/marko/src/plugins/editor-setup';
import type { EditorConfig } from '../../vendor/marko/src/plugins/editor-setup';
import type { Editor } from '@milkdown/kit/core';
import { searchHighlightPlugin } from './search-highlight';
export const getEditorPlugins = () => [...sharedPlugins({ history: false, blockHandles: true, contents: true }).flat(), searchHighlightPlugin];
export const configureEditor = (editor: Editor, config: Omit<EditorConfig, 'spellcheck'>) => sharedConfig(editor, {...config, spellcheck: false});
