import assert from "node:assert/strict";
import test from "node:test";
import { Editor, remarkCtx, remarkPluginsCtx } from "@milkdown/kit/core";
import { remarkGFMPlugin } from "@milkdown/kit/preset/gfm";
import { SourceMarkdown } from "../src/lib/source-markdown";
import fixtures from "./fixtures/reliability.json";

async function processor() {
  const ctx = Editor.make().ctx;
  ctx.inject(remarkCtx).inject(remarkPluginsCtx, []);
  ctx.inject(remarkGFMPlugin.options.key, { tablePipeAlign: false });
  ctx.wait = async () => {};
  await remarkGFMPlugin.plugin(ctx)();
  return ctx.get(remarkPluginsCtx).reduce(
    (remark, entry) => remark.use(entry.plugin, entry.options), ctx.get(remarkCtx)()
  );
}

for (const sample of fixtures.markdown) {
  test(`preserves an untouched source block: ${JSON.stringify(sample)}`, async () => {
    const remark = await processor();
    const source = '# Edit here\n\n' + sample;
    const canonical = remark.stringify(remark.parse(source));
    const model = new SourceMarkdown(source, canonical, text => remark.parse(text));
    assert.equal(model.supported, true);
    assert.equal(model.update(canonical), source, 'opening does not normalize source');
    assert.equal(model.update(canonical.replace('Edit here', 'Edited here')),
      source.replace('Edit here', 'Edited here'));
  });
}

test('preserves source of moved blocks and duplicate blocks', async () => {
  const remark = await processor();
  const source = 'First\n\n~~~js\nx()\n~~~\n\nFirst\n';
  const canonical = remark.stringify(remark.parse(source));
  const model = new SourceMarkdown(source, canonical, text => remark.parse(text));
  const moved = '```js\nx()\n```\n\nFirst\n\nFirst\n';
  assert.equal(model.update(moved), '~~~js\nx()\n~~~\n\nFirst\n\nFirst\n');
});


for (const [name, source, changed, expected] of [
  ['heading becomes a paragraph', '# Context\nNormal page.\n', 'Context\n\nNormal page.\n', 'Context\n\nNormal page.\n'],
  ['paragraph inserted before compact heading', '# Context\nNormal page.\n', 'Added\n\n# Context\n\nNormal page.\n', 'Added\n\n# Context\nNormal page.\n'],
  ['paragraphs moved past compact heading', '# Context\nFirst\n\nSecond\n', 'First\n\nSecond\n\n# Context\n', 'First\n\nSecond\n\n# Context\n'],
  ['CRLF heading conversion', '# Context\r\nNormal page.\r\n', 'Context\n\nNormal page.\n', 'Context\r\n\r\nNormal page.\r\n'],
  ['authored links retained', '# Context\nhttps://example.com/\n\n~~~js\nx()\n~~~\n', 'Context\n\n<https://example.com/>\n\n```js\nx()\n```\n', 'Context\n\nhttps://example.com/\n\n~~~js\nx()\n~~~\n'],
]) {
  test(`keeps valid block boundaries when ${name}`, async () => {
    const remark = await processor();
    const model = new SourceMarkdown(source, remark.stringify(remark.parse(source)), text => remark.parse(text));
    assert.equal(model.update(changed), expected);
    assert.equal(model.supported, true);
    assert.equal(model.update(changed), expected, 'repeated serialization does not create another edit');
  });
}

test('still rejects preserved source that would swallow an inserted block', async () => {
  const remark = await processor();
  const source = '```js\nx()\n';
  const canonical = remark.stringify(remark.parse(source));
  const model = new SourceMarkdown(source, canonical, text => remark.parse(text));
  assert.equal(model.supported, true);
  assert.throws(() => model.update(canonical + '\nAdded paragraph\n'), /preserve Markdown structure/);
  assert.equal(model.update(canonical), source, 'a rejected candidate never replaces the source');
});

test('requires source editing when the visual representation loses a construct', async () => {
  const remark = await processor();
  const source = '[label][ref]\n\n[ref]: https://example.com\n';
  const model = new SourceMarkdown(source, '[label](https://example.com)\n', text => remark.parse(text));
  assert.equal(model.supported, false);
  assert.throws(() => model.update('Something else\n'), /requires source/);
});

for (const [source, canonical] of [
  ['_A snapshot of `/vocabulary` with examples._', '*A snapshot of* *`/vocabulary`* *with examples.*'],
  ['**Use `code` here**', '**Use** **`code`** **here**'],
  ['_[label](https://example.com)_', '[*label*](https://example.com)'],
  ['**before _nested_ after**', '**before** ***nested*** **after**'],
  ['[`export.md` § Sizing the export](references/export.md)', '[`export.md`](references/export.md) [§ Sizing the export](references/export.md)'],
  ['[before `code` after](./guide.md "Title")', '[before](./guide.md "Title") [`code`](./guide.md "Title") [after](./guide.md "Title")'],
  ['[one two](./guide.md)', '[one](./guide.md) [two](./guide.md)'],
]) {
  test(`accepts distributed inline formatting and preserves authored blocks: ${source}`, async () => {
    const remark = await processor();
    const original = '# Heading\n\n' + source + '\n';
    const serialized = '# Heading\n\n' + canonical + '\n';
    const model = new SourceMarkdown(original, serialized, text => remark.parse(text));
    assert.equal(model.supported, true);
    assert.equal(model.update(serialized), original);
    assert.equal(model.update(serialized.replace('Heading', 'Changed')),
      original.replace('Heading', 'Changed'));
  });
}

for (const [source, changed] of [
  ['_Use `code` here_', 'Use `code` here'],
  ['_Use `code` here_', '*Use* `code` *here*'],
  ['**bold**', '*bold*'],
  ['~~deleted~~', 'deleted'],
  ['_two words_', '*twowords*'],
  ['_two  words_', '*two words*'],
  ['_[label](https://example.com)_', '[*label*](https://example.org)'],
  ['`a  b`', '`a b`'],
  ['first\n\nsecond', 'first\nsecond'],
  ['[`code` label](./guide.md)', '[`code`](./guide.md) [label](./other.md)'],
  ['[`code` label](./guide.md "Title")', '[`code`](./guide.md "Title") [label](./guide.md "Changed")'],
  ['[`code` label](./guide.md)', '[`code`](./guide.md) label'],
  ['[`code` label](./guide.md)', '[`code`](./guide.md)[label](./guide.md)'],
  ['[one](./guide.md) and [two](./guide.md)', '[one and two](./guide.md)'],
  ['before  \nafter', 'before\nafter'],
]) {
  test(`still detects meaningful content or formatting changes: ${source}`, async () => {
    const remark = await processor();
    assert.equal(new SourceMarkdown(source, changed, text => remark.parse(text)).supported, false);
    const model = new SourceMarkdown(source, source, text => remark.parse(text));
    assert.equal(model.update(changed), changed);
  });
}

import { Frontmatter, metadataEnvelope, documentFrontmatter } from '../src/lib/frontmatter';
import { parseDocument } from 'yaml';

for (const source of [
  '\n---\ntitle: Later\n---\n',
  '# Intro\n\n---\ntitle: Later\n---\n',
  '---\n\ncustom-ui-ux\ncustom-slide-creator\n\n---\n\ncurator-ui-ux\n\n---\n',
  '---\n- first\n- second\n---\nBody\n',
  '---\nordinary text\n---\ntitle: Later\n---\n',
]) {
  test(`keeps prose and later separators in Markdown: ${JSON.stringify(source)}`, () => {
    assert.deepEqual(documentFrontmatter(source), {
      body: source, prefix: '', raw: '', hasFrontmatter: false, eol: '\n',
    });
  });
}

for (const raw of ['title: Real\n', '', '# Metadata comment\n', 'tags: [unterminated\n', 'body: |\n  ---\n  Still YAML\n', 'title: "---"\n']) {
  test(`recognizes only the first header and preserves repairable YAML: ${JSON.stringify(raw)}`, () => {
    const prefix = `---\n${raw}---\n`;
    const body = '\n# Body\n\n---\ntitle: This stays in the body\n---\n';
    const split = documentFrontmatter(prefix + body);
    assert.equal(split.hasFrontmatter, true);
    assert.equal(split.prefix, prefix);
    assert.equal(split.body, body);
  });
}

for (const sample of fixtures.yaml) {
  test(`editing a title preserves other YAML bytes and types: ${JSON.stringify(sample)}`, () => {
    const raw = 'editable_title: "Before" # keep\n' + sample + '\n';
    const model = new Frontmatter(raw);
    assert.equal(model.error, '');
    const next = model.editValue(['editable_title'], '"After"');
    assert.equal(next, raw.replace('"Before"', '"After"'));
    const beforeValue = parseDocument(raw).toJS();
    beforeValue.editable_title = 'After';
    assert.deepEqual(parseDocument(next).toJS(), beforeValue);
  });
}

test('literal dotted keys remain distinct from nested paths', () => {
  const model = new Frontmatter('a.b: literal\na:\n  b: nested\n');
  assert.equal(model.editValue(['a.b'], '"changed"'), 'a.b: "changed"\na:\n  b: nested\n');
  assert.equal(model.editValue(['a', 'b'], '"changed"'), 'a.b: literal\na:\n  b: "changed"\n');
});

test('adding a visual field preserves all existing YAML bytes and string values', () => {
  for (const raw of ['', '# Keep\n', 'name: "Example" # keep\ncount: 3\n', 'name: Example', 'name: Example\r\n']) {
    for (const value of ['', 'false', '0123', 'null', 'first\nsecond\n', '---\n# not a header']) {
      const next = new Frontmatter(raw).addValue('author', JSON.stringify(value));
      assert.ok(next.startsWith(raw));
      assert.equal(parseDocument(next).get('author'), value);
      assert.equal(new Frontmatter(next).error, '');
      if (raw.includes('\r\n')) assert.ok(!/(?<!\r)\n/.test(next));
    }
  }
});

test('visual additions handle flow maps, empty maps and unusual literal keys', () => {
  for (const raw of ['{}\n', '{ name: Example } # keep\n', '{ name: Example, }\n']) {
    for (const key of ['true', '__proto__', 'name: other', 'key with spaces', 'quote"key']) {
      const next = new Frontmatter(raw).addValue(key, 'text');
      assert.equal(parseDocument(next).get(key), 'text');
      assert.equal(parseDocument(next).get('name'), parseDocument(raw).get('name'));
      assert.equal(new Frontmatter(next).error, '');
      if (raw.includes('# keep')) assert.ok(next.endsWith(' # keep\n'));
    }
  }
});

test('visual values use authored YAML syntax without forced quotes', () => {
  for (const [value, expected] of [
    ['[hello]', ['hello']], ['false', false], ['42', 42], ['null', null],
    ['hello', 'hello'], ['"[hello]"', '[hello]'], ["'hello'", 'hello'],
  ] as const) {
    for (const raw of ['', 'foo:\n  existing: keep\n', '{foo: {existing: keep}}']) {
      const next = new Frontmatter(raw).addValue('foo.bar', value);
      assert.deepEqual(parseDocument(next).toJS().foo.bar, expected);
      assert.equal(new Frontmatter(next).fields().find(field => field.label === 'foo.bar')?.value, value);
      const edited = new Frontmatter(next).editValue(['foo', 'bar'], '[hello, world]');
      assert.deepEqual(parseDocument(edited).toJS().foo.bar, ['hello', 'world']);
      assert.equal(parseDocument(edited).toJS().foo.existing, parseDocument(next).toJS().foo.existing);
    }
  }
  assert.equal(new Frontmatter('').addValue('foo.bar', '[hello]'), 'foo:\n  bar: [hello]\n');
});

test('visual YAML editing preserves indentation, comments, and CRLF', () => {
  const raw = 'foo:\r\n  bar: "old" # keep\r\nother: yes\r\n';
  assert.equal(new Frontmatter(raw).editValue(['foo', 'bar'], '[hello]'), raw.replace('"old"', '[hello]'));
  const block = new Frontmatter('foo:\n  bar: old\nother: keep\n').editValue(['foo', 'bar'], '|\n  hello\n  world');
  assert.equal(block, 'foo:\n  bar: |\n    hello\n    world\nother: keep\n');
  assert.equal(new Frontmatter(block).fields().find(field => field.label === 'foo.bar')?.value, '|\n  hello\n  world');
  assert.throws(() => new Frontmatter(raw).editValue(['foo', 'bar'], '[unfinished'));
});

test('visual field creation rejects empty names, duplicates and malformed headers', () => {
  assert.throws(() => new Frontmatter('').addValue('  ', 'value'), /field name/);
  assert.throws(() => new Frontmatter('name: Before\n').addValue(' name ', 'After'), /already exists/);
  assert.throws(() => new Frontmatter('bad: [\n').addValue('name', 'After'));
  assert.throws(() => new Frontmatter('- item\n').addValue('name', 'After'), /mapping/);
  const raw = 'metadata:\n  category: Utility\n';
  assert.throws(() => new Frontmatter(raw).addValue('metadata.category', 'other'), /already exists/);
});

test('dotted additions create nested fields and preserve existing source bytes', () => {
  for (const eol of ['\n', '\r\n']) {
    const raw = ['name: Example # keep', 'metadata:', '  last_reviewed: "2026-09-18"', 'after: true', ''].join(eol);
    const next = new Frontmatter(raw).addValue('metadata.priority', 'high');
    assert.equal(next, raw.replace('after: true', `  priority: high${eol}after: true`));
    assert.equal(parseDocument(next).getIn(['metadata', 'priority']), 'high');
    assert.equal(parseDocument(next).has('metadata.priority'), false);
    assert.equal(new Frontmatter(next).fields().find(field => field.label === 'metadata.priority')?.editable, true);
  }
});

test('dotted additions create missing levels and support existing block and flow maps', () => {
  for (const raw of ['', '# comment\n', '{}', 'metadata: {}\n', 'metadata:\n  category: Utility\n', '{metadata: {category: Utility, }, name: Example}', 'metadata:\n    category: Utility\n# keep\nname: Example\n']) {
    const model = new Frontmatter(raw);
    const next = model.addValue('metadata.review.tags', '"false"');
    assert.equal(new Frontmatter(next).error, '', next);
    assert.equal(parseDocument(next).getIn(['metadata', 'review', 'tags']), 'false');
    assert.equal(parseDocument(next).getIn(['metadata', 'category']), model.document.getIn(['metadata', 'category']));
    const changed = new Frontmatter(next).editValue(['metadata', 'review', 'tags'], 'updated');
    assert.equal(parseDocument(changed).getIn(['metadata', 'review', 'tags']), 'updated');
    assert.equal(new Frontmatter(changed).fields().find(field => field.label === 'metadata.review.tags')?.value, 'updated');
  }
});

test('nested additions reject invalid paths and occupied parents without overwriting data', () => {
  for (const name of ['.metadata', 'metadata.', 'metadata..tags', 'metadata. .tags']) {
    assert.throws(() => new Frontmatter('').addValue(name, 'value'), /nonempty parts/);
  }
  for (const raw of ['metadata: text', 'metadata: null', 'metadata: [one]', 'metadata: &meta {}', 'base: &meta {}\nmetadata: *meta']) {
    assert.throws(() => new Frontmatter(raw).addValue('metadata.tags', 'value'), /mapping/);
  }
  const raw = 'metadata.priority: literal\nmetadata:\n  category: Utility\n';
  const next = new Frontmatter(raw).addValue('metadata.priority', 'nested');
  assert.equal(parseDocument(next).get('metadata.priority'), 'literal');
  assert.equal(parseDocument(next).getIn(['metadata', 'priority']), 'nested');
});

for (const [raw, path, expected] of [
  ['# Keep\nname: Example # remove with field\n# Next\ncount: 4\n', ['name'], '# Keep\n# Next\ncount: 4\n'],
  ['meta:\n  category: Utility\n  date: 2026-09-12\nname: Example\n', ['meta', 'category'], 'meta:\n  date: 2026-09-12\nname: Example\n'],
  ['meta:\n  category: Utility\nname: Example\n', ['meta', 'category'], 'meta:\n  {}\nname: Example\n'],
  ['meta:\r\n  category: Utility\r\nname: Example\r\n', ['meta', 'category'], 'meta:\r\n  {}\r\nname: Example\r\n'],
  ['description: |\n  Long\n  text\nkeep: "yes"\n', ['description'], 'keep: "yes"\n'],
  ['tags:\n  - one\n  - two\nkeep: true\n', ['tags'], 'keep: true\n'],
  ['empty:\nkeep: null\n', ['empty'], 'keep: null\n'],
  ['a.b: literal\na:\n  b: nested\n', ['a.b'], 'a:\n  b: nested\n'],
  ['name: Example', ['name'], ''],
] as [string, string[], string][]) {
  test(`remove metadata field without rewriting neighbours: ${JSON.stringify(raw)}`, () => {
    const model = new Frontmatter(raw);
    assert.equal(model.removeField(path), expected);
    assert.equal(model.raw, raw);
    assert.equal(new Frontmatter(expected).error, '');
  });
}

test('remove fields from flow maps, including first, middle and last entries', () => {
  for (const key of ['a', 'b', 'c']) {
    const raw = '# Keep\nmeta: { a: 1, b: two, c: false } # keep\nnext: "same"\n';
    const next = new Frontmatter(raw).removeField(['meta', key]);
    const expected = parseDocument(raw).toJS(); delete expected.meta[key];
    assert.deepEqual(parseDocument(next).toJS(), expected);
    assert.ok(next.startsWith('# Keep\nmeta: {'));
    assert.ok(next.endsWith(' # keep\nnext: "same"\n'));
  }
});

test('removing an anchor cannot leave broken references', () => {
  const raw = 'original: &value hello\nreference: *value\n';
  assert.throws(() => new Frontmatter(raw).removeField(['original']), /YAML alias/);
  assert.equal(new Frontmatter(raw).removeField(['reference']), 'original: &value hello\n');
  assert.throws(() => new Frontmatter('broken: [\n').removeField(['broken']));
});

test('invalid YAML is kept verbatim, with a positioned error and no structured edit', () => {
  const raw = 'tags: [unterminated\n';
  const model = new Frontmatter(raw);
  assert.equal(model.raw, raw);
  assert.match(model.error, /line 2, column 1/);
  assert.deepEqual(model.fields(), []);
  assert.throws(() => model.editValue(['tags'], 'oops'));
});

test('block string replacement does not join or damage the next property', () => {
  const raw = 'text: |\n  Old\n  text\nnext: "false"\n';
  const next = new Frontmatter(raw).editValue(['text'], JSON.stringify('New\ntext\n'));
  assert.equal(next, 'text: "New\\ntext\\n"\nnext: "false"\n');
  assert.equal(parseDocument(next).toJS().next, 'false');
});

test('anchors stay protected while YAML scalars and lists are editable', () => {
  const model = new Frontmatter('a: &a anchored\nb: *a\nc: false\nd: null\ne: []\n');
  assert.deepEqual(model.fields().map(field => field.editable), [false, false, true, true, true]);
  assert.deepEqual(parseDocument(model.editValue(['c'], '[hello]')).toJS().c, ['hello']);
});

test('metadata edits preserve BOM, CRLF, comments and delimiter whitespace', () => {
  const prefix = '\ufeff--- \t\r\ntitle: "Before" # comment\r\n--- \t\r\n';
  const envelope = metadataEnvelope(prefix, '\r\n');
  assert.equal(envelope.join(envelope.raw), prefix);
  assert.equal(envelope.join(new Frontmatter(envelope.raw).editValue(['title'], '"After"')),
    prefix.replace('"Before"', '"After"'));
});

import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection, Plugin } from '@milkdown/kit/prose/state';
import { applyEditorTransaction, DOCUMENT_ORIGIN } from '../src/lib/editor-transaction';
const schema = new Schema({ nodes: {
  doc: { content: 'block+' },
  paragraph: { group: 'block', content: 'text*' },
  code: { group: 'block', content: 'text*', attrs: { language: { default: '' } } },
  text: {},
}});
function transactionView() {
  return {
    state: EditorState.create({schema, doc: schema.node('doc', null, [
      schema.node('code', {language: 'js'}, schema.text('example()')),
      schema.node('paragraph', null, schema.text('body')),
    ])}),
    updateState(state: EditorState) { this.state = state; },
  };
}
for (const action of ['language', 'clear', 'delete']) {
  test(`first code ${action} action persists synchronously without a DOM event gate`, () => {
    const view = transactionView();
    const tr = view.state.tr;
    if (action === 'language') tr.setNodeMarkup(0, undefined, {language: 'python'});
    if (action === 'clear') tr.delete(1, view.state.doc.child(0).nodeSize - 1);
    if (action === 'delete') tr.delete(0, view.state.doc.child(0).nodeSize);
    const sent: unknown[] = [];
    applyEditorTransaction(view, tr, doc => sent.push(doc.toJSON()));
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0], view.state.doc.toJSON());
  });
}
test('selection and external replacement transactions never echo as local edits', () => {
  const view = transactionView();
  let sends = 0;
  applyEditorTransaction(view, view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)), () => sends++);
  applyEditorTransaction(view, view.state.tr.insertText('external', 2).setMeta(DOCUMENT_ORIGIN, 'external'), () => sends++);
  assert.equal(sends, 0);
});
test('appended document changes are included in the same persisted action', () => {
  const view = transactionView();
  view.state = view.state.reconfigure({ plugins: [new Plugin({
    appendTransaction(transactions, _old, state) {
      return transactions.some(tr => tr.getMeta('append')) ? state.tr.insertText('!', 2) : null;
    },
  })] });
  let final = '';
  applyEditorTransaction(view, view.state.tr.insertText('X', 1).setMeta('append', true), doc => { final = doc.textContent; });
  assert.equal(final, view.state.doc.textContent);
  assert.match(final, /^X!/);
});

import { SyncClient, type DocumentUpdate } from '../src/lib/sync-client';
const update = (version: number, text: string, dirty = false): DocumentUpdate => ({ type: 'update', version, text, dirty });
function client() { const result = new SyncClient('test'); result.receive(update(1, 'original')); return result; }

test('coalesces typing and waits for an identifiable acknowledgment', () => {
  const sync = client();
  sync.edit('one'); const request = sync.next()!;
  sync.edit('two'); assert.equal(sync.next(), null);
  sync.receive(update(2, 'one', true));
  assert.equal(sync.text, 'two'); assert.equal(sync.next(), null);
  sync.receive({...update(2, 'one', true), type:'editResult', requestId: request.requestId, status:'applied'});
  assert.equal(sync.next()!.text, 'two');
  assert.equal(sync.version, 2); assert.equal(sync.error, '');
});
test('external changes and delayed results retain the local draft without rollback', () => {
  const sync = client(); sync.edit('draft'); const request = sync.next()!;
  sync.receive(update(3, 'external'));
  sync.receive({...update(2, 'draft'), type:'editResult', requestId:request.requestId, status:'applied'});
  assert.equal(sync.text, 'draft'); assert.equal(sync.baseText, 'external');
  assert.equal(sync.version, 3); assert.equal(sync.conflicted, true);
  sync.retry(); assert.equal(sync.next(), null);
  const recovered = new SyncClient('new', sync.draft);
  recovered.receive(update(3, 'external'));
  assert.equal(recovered.text, 'draft'); assert.equal(recovered.next(), null);
});
test('old updates and unrelated acknowledgments cannot replace a newer document', () => {
  const sync = client(); sync.receive(update(3, 'new'));
  sync.receive(update(2, 'old'));
  sync.receive({...update(4, 'unrelated'), type:'editResult', requestId:'unknown', status:'applied'});
  assert.equal(sync.text, 'new'); assert.equal(sync.version, 3);
});
test('rejected requests retain drafts and transport retries wait for the host snapshot', () => {
  const sync = client(); sync.edit('draft'); const request = sync.next()!;
  sync.receive({...update(1,'original'), type:'editResult', requestId:request.requestId, status:'error', error:'not writable'});
  assert.equal(sync.draft!.text, 'draft'); assert.equal(sync.next(), null);
  sync.retry(); sync.receive(update(1, 'original'));
  assert.equal(sync.next()!.text, 'draft');
  sync.disconnected(); assert.equal(sync.next(), null);
  sync.retry(); sync.receive(update(2, 'external'));
  assert.equal(sync.conflicted, true); assert.equal(sync.next(), null);
});
test('recovering a draft already accepted by the host does not duplicate the edit', () => {
  const sync = new SyncClient('reopened', {text:'draft',baseText:'original'});
  sync.receive(update(2,'draft',true));
  assert.equal(sync.next(), null); assert.equal(sync.dirty, true);
  assert.equal(sync.draft, null);
});

import { FlushActions } from '../src/lib/flush-actions';
test('a file updated to the retained draft resolves the live conflict', () => {
  const sync = new SyncClient('reopened', {text:'draft',baseText:'original',conflicted:true});
  sync.receive(update(1,'original')); assert.equal(sync.conflicted,true);
  sync.receive(update(2,'draft')); assert.equal(sync.conflicted,false);
  assert.equal(sync.error,''); assert.equal(sync.draft,null); assert.equal(sync.next(),null);
});

test('errors without divergent text do not leave stale recovery drafts', () => {
  const sync = client(); sync.disconnected();
  assert.equal(sync.draft, null);
  const reopened = new SyncClient('reopened', {text:'old',baseText:'old',conflicted:true});
  reopened.receive(update(2,'new file'));
  assert.equal(reopened.text,'new file'); assert.equal(reopened.error,'');
});

test('reopening an already accepted conflicted draft clears the stale warning', () => {
  const sync = new SyncClient('reopened', {text:'draft',baseText:'original',conflicted:true});
  sync.receive(update(2,'draft',true));
  assert.equal(sync.error, ''); assert.equal(sync.conflicted, false);
  assert.equal(sync.draft, null); assert.equal(sync.next(), null);
});
test('source conversion failures do not become permanent file conflicts', () => {
  const sync = client();
  sync.retainSource('draft', 'Source conversion failed');
  assert.equal(sync.conflicted, false); assert.equal(sync.next(), null);
  const reopened = new SyncClient('reopened', sync.draft);
  reopened.receive(update(1,'original'));
  assert.equal(reopened.error, 'Source conversion failed');
  assert.equal(reopened.next(), null);
  reopened.sourceSucceeded();
  assert.equal(reopened.error, ''); assert.equal(reopened.next()!.text, 'draft');
});
test('source success never clears a concurrent file conflict', () => {
  const sync = client(); sync.retainSource('draft', 'Conversion failed');
  sync.receive(update(2,'external')); sync.sourceSucceeded();
  assert.equal(sync.conflicted, true); assert.equal(sync.next(), null);
});
test('explicit restoration keeps edits typed while confirmation was open', () => {
  const sync = new SyncClient('reopened', {text:'draft',baseText:'original',conflicted:true});
  sync.receive(update(1,'original'));
  const request = sync.restoreRequest()!;
  assert.equal(request.type, 'restoreDraft'); assert.equal(sync.next(), null);
  sync.edit('draft plus more');
  sync.receive(update(2,'draft',true));
  sync.receive({...update(2,'draft',true), type:'editResult', requestId:request.requestId, status:'applied'});
  assert.equal(sync.error, ''); assert.equal(sync.conflicted, false);
  assert.equal(sync.next()!.text, 'draft plus more');
});
test('restoration does not clear a newer external change or a cancellation', () => {
  for (const status of ['applied','error'] as const) {
    const sync = new SyncClient('reopened', {text:'draft',baseText:'original',conflicted:true});
    sync.receive(update(1,'original')); const request = sync.restoreRequest()!;
    sync.receive(update(3,'external'));
    sync.receive({...update(2,'draft'), type:'editResult', requestId:request.requestId, status});
    assert.equal(sync.text, 'draft'); assert.equal(sync.baseText, 'external');
    assert.equal(sync.conflicted, true); assert.equal(sync.next(), null);
  }
});

test('Save, Copy and Edit source wait for the latest acknowledged draft', () => {
  const actions = new FlushActions(); const sent: unknown[] = [];
  for (const type of ['save','copyDocument','openRaw']) actions.enqueue({type});
  actions.drain(true,'',action => sent.push(action));
  assert.deepEqual(sent,[]);
  actions.drain(false,'',action=>sent.push(action));
  assert.deepEqual(sent,[{type:'save'},{type:'copyDocument'},{type:'openRaw'}]);
  actions.drain(false,'',action=>sent.push(action));
  assert.equal(sent.length,3);
});
test('a conflict cancels deferred actions rather than acting on the wrong text', () => {
  const actions=new FlushActions(); actions.enqueue({type:'save'});
  const sent: unknown[] = [];
  actions.enqueue({type:'flushComplete',flushId:'f'});
  actions.drain(true,'conflict',action=>sent.push(action));
  assert.deepEqual(sent,[{type:'saveBlocked',error:'conflict'},{type:'flushComplete',flushId:'f',error:'conflict'}]);
  actions.drain(false,'',()=>assert.fail('must not replay later'));
});
test('disk status distinguishes acknowledged dirty content from saved content', () => {
  const sync=client(); sync.edit('edit'); const request=sync.next()!;
  assert.equal(sync.pending,true);
  sync.receive({...update(2,'edit',true),type:'editResult',requestId:request.requestId,status:'applied'});
  assert.equal(sync.pending,false); assert.equal(sync.dirty,true);
  sync.receive(update(2,'edit',false)); assert.equal(sync.dirty,false);
});

import { applyExternalDocument } from '../src/lib/external-document';
test('external insertions map selection to the same content and do not echo', () => {
  const view = transactionView();
  view.state = view.state.apply(view.state.tr.setSelection(TextSelection.create(view.state.doc, 5)));
  const next = view.state.tr.insertText('prefix ',1).doc;
  let echo = 0;
  applyExternalDocument({...view, dispatch: tr => applyEditorTransaction(view,tr,()=>echo++)},next);
  assert.equal(view.state.selection.head,12);
  assert.equal(view.state.doc.eq(next),true);
  assert.equal(echo,0);
});
test('external deletion and a subsequent restore keep a valid mapped selection', () => {
  const view=transactionView(); const original=view.state.doc;
  const next=view.state.tr.delete(1,10).doc;
  const adapter={get state(){return view.state;},dispatch: (tr: import('@milkdown/kit/prose/state').Transaction)=>applyEditorTransaction(view,tr,()=>assert.fail('echo'))};
  applyExternalDocument(adapter,next); applyExternalDocument(adapter,original);
  assert.equal(view.state.doc.eq(original),true);
  assert.ok(view.state.selection.head <= original.content.size);
});

import { isTypingTransaction } from '../src/lib/editor-transaction';
test('groups character typing but keeps structural and pasted actions separate', () => {
  const view=transactionView();
  assert.equal(isTypingTransaction(view.state.tr.insertText('x',1)),true);
  assert.equal(isTypingTransaction(view.state.tr.delete(1,2)),true);
  assert.equal(isTypingTransaction(view.state.tr.insertText('pasted',1)),false);
  assert.equal(isTypingTransaction(view.state.tr.setNodeMarkup(0,undefined,{language:'python'})),false);
  assert.equal(isTypingTransaction(view.state.tr.delete(0,view.state.doc.child(0).nodeSize)),false);
});

test('YAML textarea edits retain the document CRLF convention', () => {
  const envelope = metadataEnvelope('---\r\ntitle: Before\r\n---\r\n', '\r\n');
  assert.equal(envelope.join('title: After\ntags: [solo]\n'), '---\r\ntitle: After\r\ntags: [solo]\r\n---\r\n');
});

import { moveCurrentBlock } from '../src/milkdown/block-movement';
import type { EditorView } from '@milkdown/kit/prose/view';
test('keyboard block movement preserves content, attributes and cursor offsets at boundaries', () => {
  const view = {...transactionView(), editable: true, focus() {}, dispatch(tr) { this.state = this.state.apply(tr); }};
  view.state = view.state.apply(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)));
  const original = view.state.doc;
  assert.equal(moveCurrentBlock(view as unknown as EditorView, -1), false);
  assert.equal(moveCurrentBlock(view as unknown as EditorView, 1), true);
  assert.equal(view.state.doc.lastChild?.attrs.language, 'js');
  assert.equal(view.state.selection.$from.parentOffset, 2);
  assert.equal(moveCurrentBlock(view as unknown as EditorView, 1), false);
  assert.equal(moveCurrentBlock(view as unknown as EditorView, -1), true);
  assert.ok(view.state.doc.eq(original));
  assert.equal(view.state.selection.from, 3);
});

import { pasteFormat } from '../src/milkdown/markdown-paste';
test('paste format priority respects source metadata, HTML, code and full front matter', () => {
  assert.equal(pasteFormat('# Title', '<b>Title</b>', '', false), 'html');
  assert.equal(pasteFormat('# Title', '<span># Title</span>', '{"mode":"markdown"}', false), 'markdown');
  assert.equal(pasteFormat('function f() {}', '<span>function</span>', '{"mode":"javascript"}', false), 'code');
  assert.equal(pasteFormat('text', '<span>text</span>', '{invalid', false), 'plain');
  assert.equal(pasteFormat('**literal**', '', '', true), 'plain');
  assert.equal(pasteFormat('---\ntitle: "A"\n---\nBody', '', '', false), 'plain');
  assert.equal(pasteFormat('- One\n- Two', '', '', false), 'markdown');
});
test('source offsets locate the closest authored block across CRLF and blank lines', async () => {
  const remark = await processor();
  const source = '# Title\r\n\r\n\r\nParagraph\r\n\r\n~~~js\r\nx()\r\n~~~\r\n';
  const model = new SourceMarkdown(source, remark.stringify(remark.parse(source)), text => remark.parse(text));
  assert.equal(model.blockOffset(1), source.indexOf('Paragraph'));
  assert.equal(model.blockIndexAtOffset(source.indexOf('x()')), 2);
  assert.equal(model.blockIndexAtOffset(0), 0);
});

import { blockSelectionKey, blockSelectionPlugin, blockUnits, selectedUnits } from '../src/milkdown/block-selection';
import { moveBlockGroup } from '../src/milkdown/block-movement';
import { history, undo, redo } from '@milkdown/kit/prose/history';
const groupSchema = new Schema({nodes: {
  doc: {content: 'block+'}, paragraph: {group: 'block', content: 'text*'},
  heading: {group: 'block', content: 'text*'}, code_block: {group: 'block', content: 'text*'},
  table: {group: 'block', content: 'paragraph+'},
  bullet_list: {group: 'block', content: 'list_item+'},
  ordered_list: {group: 'block', content: 'list_item+'},
  list_item: {content: 'paragraph block*'}, text: {},
}});
function groupView() {
  const p = (text: string) => groupSchema.node('paragraph', null, text ? groupSchema.text(text) : undefined);
  const doc = groupSchema.node('doc', null, [p('first'), p(''), groupSchema.node('heading', null, groupSchema.text('Heading')),
    groupSchema.node('table', null, [p('cell')]), groupSchema.node('bullet_list', null, [
      groupSchema.node('list_item', null, [p('one')]),
      groupSchema.node('list_item', null, [p('two'), groupSchema.node('bullet_list', null, [groupSchema.node('list_item', null, [p('nested')])])]),
      groupSchema.node('list_item', null, [p('three')]),
    ]), p('last')]);
  const view = {state: EditorState.create({schema: groupSchema, doc, plugins: [blockSelectionPlugin(), history()]}), editable: true,
    dispatch(tr: import('@milkdown/kit/prose/state').Transaction) {this.state = this.state.apply(tr);}, focus() {}};
  return view;
}
test('block groups include empty paragraphs and whole tables without changing text selection', () => {
  const view = groupView(), units = blockUnits(view.state.doc), selection = view.state.selection;
  view.dispatch(view.state.tr.setMeta(blockSelectionKey, {parent: -1, anchor: units[1].from, head: units[3].from}));
  assert.deepEqual(selectedUnits(view.state.doc, blockSelectionKey.getState(view.state)).map(unit => unit.node.type.name), ['paragraph', 'heading', 'table']);
  assert.equal(view.state.selection, selection);
  view.dispatch(view.state.tr.insertText('prefix', 1));
  assert.deepEqual(selectedUnits(view.state.doc, blockSelectionKey.getState(view.state)).map(unit => unit.node.type.name), ['paragraph', 'heading', 'table']);
});
test('deleting a selected endpoint clears the group instead of selecting a replacement block', () => {
  const view = groupView(), units = blockUnits(view.state.doc);
  view.dispatch(view.state.tr.setMeta(blockSelectionKey, {parent: -1, anchor: units[0].from, head: units[1].from}));
  view.dispatch(view.state.tr.delete(units[0].from, units[0].to));
  assert.equal(blockSelectionKey.getState(view.state), null);
});
test('mixed block groups move once, retain order and support one-action undo/redo', () => {
  const view = groupView(), original = view.state.doc, units = blockUnits(original);
  const group = {parent: -1, anchor: units[1].from, head: units[3].from};
  assert.equal(moveBlockGroup(view as unknown as EditorView, group, units.at(-1)!.to), true);
  assert.deepEqual(blockUnits(view.state.doc).map(unit => unit.node.type.name), ['paragraph','bullet_list','paragraph','paragraph','heading','table']);
  const moved = view.state.doc;
  assert.equal(selectedUnits(moved, blockSelectionKey.getState(view.state)).length, 3);
  assert.equal(undo(view.state, tr => view.dispatch(tr)), true); assert.ok(view.state.doc.eq(original));
  assert.equal(redo(view.state, tr => view.dispatch(tr)), true); assert.ok(view.state.doc.eq(moved));
});
test('list item groups retain nested lists and reject other-parent and self destinations', () => {
  const view = groupView(), doc = view.state.doc, root = blockUnits(doc), list = root[4];
  const items = blockUnits(doc, list.from), group = {parent: list.from, anchor: items[0].from, head: items[1].from};
  assert.equal(moveBlockGroup(view as unknown as EditorView, group, root[0].from), false);
  assert.equal(moveBlockGroup(view as unknown as EditorView, group, items[1].from), false);
  assert.equal(moveBlockGroup(view as unknown as EditorView, group, items.at(-1)!.to), true);
  assert.deepEqual(blockUnits(view.state.doc, list.from).map(unit => unit.node.textContent), ['three','one','twonested']);
  assert.ok(view.state.doc.nodeAt(list.from)!.child(2).child(1).eq(list.node.child(1).child(1)));
});
test('group movement respects editor locking and boundary commands', () => {
  const view = groupView(), units = blockUnits(view.state.doc);
  view.dispatch(view.state.tr.setMeta(blockSelectionKey, {parent: -1, anchor: units[0].from, head: units[1].from}));
  assert.equal(moveCurrentBlock(view as unknown as EditorView, -1), false);
  view.editable = false; assert.equal(moveCurrentBlock(view as unknown as EditorView, 1), false);
  view.editable = true; assert.equal(moveCurrentBlock(view as unknown as EditorView, 1), true);
  assert.equal(selectedUnits(view.state.doc, blockSelectionKey.getState(view.state)).length, 2);
});

import { isInlineMarkActive } from '../src/milkdown/formatting-state';
import { CellSelection, tableNodes } from '@milkdown/kit/prose/tables';
const formattingSchema = new Schema({nodes: {
  doc: {content: 'block+'}, paragraph: {group: 'block', content: 'inline*'},
  text: {group: 'inline'}, ...tableNodes({tableGroup: 'block', cellContent: 'paragraph+'}),
}, marks: {strong: {}, emphasis: {}, strike_through: {}, inlineCode: {}}});
for (const name of ['strong', 'emphasis', 'strike_through', 'inlineCode']) {
  test(`formatting state: ${name} follows the caret, stored marks and actual selected text`, () => {
    const mark = formattingSchema.marks[name].create();
    const doc = formattingSchema.node('doc', null, [formattingSchema.node('paragraph', null, [
      formattingSchema.text('marked', [mark]), formattingSchema.text(' plain'),
    ])]);
    const state = EditorState.create({schema: formattingSchema, doc, selection: TextSelection.create(doc, 3)});
    assert.equal(isInlineMarkActive(state, name), true);
    assert.equal(isInlineMarkActive(state.apply(state.tr.setStoredMarks([])), name), false);
    const plain = state.apply(state.tr.setSelection(TextSelection.create(doc, 10)));
    assert.equal(isInlineMarkActive(plain, name), false);
    assert.equal(isInlineMarkActive(plain.apply(plain.tr.addStoredMark(mark)), name), true);
    const selected = state.apply(state.tr.setSelection(TextSelection.create(doc, 1, 7)));
    assert.equal(isInlineMarkActive(selected, name), true);
    assert.equal(isInlineMarkActive(state.apply(state.tr.setSelection(TextSelection.create(doc, 1, 10))), name), false);
    assert.equal(isInlineMarkActive(selected, 'missing'), false);
  });
  test(`formatting state: ${name} reads separate cell-selection ranges`, () => {
    const mark = formattingSchema.marks[name].create();
    const cell = (marked: boolean) => formattingSchema.node('table_cell', null,
      formattingSchema.node('paragraph', null, formattingSchema.text('cell', marked ? [mark] : [])));
    const row = () => formattingSchema.node('table_row', null, [cell(true), cell(false)]);
    const doc = formattingSchema.node('doc', null, formattingSchema.node('table', null, [row(), row()]));
    const positions: number[] = [];
    doc.descendants((node, pos) => { if (node.type.name === 'table_cell') positions.push(pos); });
    const state = EditorState.create({schema: formattingSchema, doc,
      selection: CellSelection.create(doc, positions[0], positions[2])});
    assert.equal(isInlineMarkActive(state, name), true, 'unselected neighboring cells must not affect a column selection');
    assert.equal(isInlineMarkActive(state.apply(state.tr.setSelection(CellSelection.create(doc, positions[0], positions[1]))), name), false);
  });
}
test('empty cells do not report every formatting mark as active', () => {
  const doc = formattingSchema.node('doc', null, formattingSchema.node('table', null,
    formattingSchema.node('table_row', null, formattingSchema.node('table_cell', null, formattingSchema.node('paragraph')))));
  const state = EditorState.create({schema: formattingSchema, doc, selection: CellSelection.create(doc, 2)});
  assert.equal(isInlineMarkActive(state, 'strong'), false);
});

for (const bullet of ['-', '*', '+']) {
  test(`keeps authored ${bullet} bullets when editing and extending a list`, async () => {
    const remark = await processor();
    const source = `${bullet} First\n${bullet} Second\n`;
    const canonical = remark.stringify(remark.parse(source));
    const model = new SourceMarkdown(source, canonical, text => remark.parse(text));
    assert.equal(model.update(canonical.replace('First', 'Edited')), source.replace('First', 'Edited'));
    const extended = `${bullet} Edited\n${bullet} Second\n${bullet} Third\n`;
    assert.equal(model.update(remark.stringify(remark.parse(extended))), extended);
    assert.equal(model.update(canonical), source, 'restoring content keeps the list style');
  });
}

function bulletTokens(source: string, tree: any): string[] {
  const result: string[] = [];
  const visit = (node: any) => {
    if (node.type === 'list' && !node.ordered) {
      for (const item of node.children) result.push(source[item.position.start.offset]);
    }
    node.children?.forEach(visit);
  };
  visit(tree); return result;
}
for (const [name, source, changed] of [
  ['nested styles', '- Parent\n  + Nested\n  + Other\n- Second\n', '- Edited\n  + Nested\n  + Other\n- Second\n'],
  ['nested text edit', '- Parent\n  + Nested\n  + Other\n- Second\n', '- Parent\n  + Edited\n  + Other\n- Second\n'],
  ['new nested item', '- Parent\n  + Nested\n', '- Parent\n  + Nested\n  + Added\n'],
  ['new nested list inherits parent', '- Parent\n', '- Parent\n  - Added\n'],
  ['separate list styles', '- First\n\n## Heading\n\n+ Second\n', '- Edited\n\n## Heading\n\n+ Changed\n'],
  ['insert heading before edited list', '- First\n- Second\n', '# Added\n\n- Edited\n- Second\n'],
  ['insert list before unchanged list', '- First\n\n# Heading\n\n+ Second\n', '* New\n\n## New heading\n\n- First\n\n# Heading\n\n+ Second\n'],
  ['quoted task list', '> - [ ] First\n> - [x] Second\n', '> - [x] First\n> - [x] Second\n'],
  ['fenced examples within list', '- First\n\n  ```md\n  * literal\n  - literal\n  ```\n', '- Edited\n\n  ```md\n  * literal\n  - literal\n  ```\n'],
  ['CRLF', '- First\r\n- Second\r\n', '- Edited\r\n- Second\r\n'],
  ['adjacent list styles', '- First\n\n+ Second\n', '- Edited\n\n+ Second\n'],
]) {
  test(`preserves bullet tokens: ${name}`, async () => {
    const remark = await processor();
    const canonical = remark.stringify(remark.parse(source));
    const model = new SourceMarkdown(source, canonical, text => remark.parse(text));
    const next = remark.stringify(remark.parse(changed));
    const actual = model.update(next);
    assert.deepEqual(bulletTokens(actual, remark.parse(actual)), bulletTokens(changed, remark.parse(changed)));
    if (name === 'fenced examples within list') assert.match(actual, /\* literal\n\s+- literal/);
    if (name === 'CRLF') assert.ok(!/(?<!\r)\n/.test(actual));
  });
}
