import assert from "node:assert/strict";
import { test } from "node:test";
import { Schema } from "@milkdown/kit/prose/model";
import { EditorState, TextSelection } from "@milkdown/kit/prose/state";
import { selectedParagraphs, splitListItems } from "../src/milkdown/slash-list";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    text: { group: "inline" },
    hardbreak: { inline: true, group: "inline" },
    code_block: { content: "text*", group: "block", code: true },
    bullet_list: { content: "list_item+", group: "block" },
    list_item: { content: "paragraph" },
  },
  marks: { strong: {}, link: { attrs: { href: {} } } },
});
const p = (text: string) => schema.nodes.paragraph.create(null, schema.text(text));
const items = (blocks: ReturnType<typeof p>[]) => splitListItems(blocks, schema.nodes.paragraph, schema.nodes.list_item);

test("one list entry per paragraph, soft newline and explicit line break", () => {
  const hard = schema.nodes.paragraph.create(null, [schema.text("three"), schema.nodes.hardbreak.create(), schema.text("four")]);
  assert.deepEqual(items([p("one\ntwo"), hard]).map(node => node.textContent), ["one", "two", "three", "four"]);
});

test("conversion preserves bold and link marks across lines", () => {
  const marks = [schema.marks.strong.create(), schema.marks.link.create({ href: "https://example.com" })];
  const block = schema.nodes.paragraph.create(null, schema.text("first\nsecond", marks));
  for (const item of items([block])) {
    assert.deepEqual(item.firstChild!.firstChild!.marks.map(mark => mark.toJSON()), marks.map(mark => mark.toJSON()));
  }
});

test("selection expands to whole paragraphs and excludes next untouched paragraph", () => {
  const first = p("first");
  const second = p("second");
  const doc = schema.nodes.doc.create(null, [first, second, p("untouched")]);
  const state = EditorState.create({ doc, selection: TextSelection.create(doc, 2, first.nodeSize + second.nodeSize + 1) });
  const range = selectedParagraphs(state)!;
  assert.equal(range.from, 0);
  assert.equal(range.to, first.nodeSize + second.nodeSize);
  assert.deepEqual(range.blocks.map(node => node.textContent), ["first", "second"]);
  const replacement = schema.nodes.bullet_list.create(null, items(range.blocks));
  const changed = state.tr.replaceWith(range.from, range.to, replacement).doc;
  assert.equal(changed.lastChild!.textContent, "untouched");
});

test("code blocks cannot become accidental list targets", () => {
  const doc = schema.nodes.doc.create(null, schema.nodes.code_block.create(null, schema.text("/list")));
  assert.equal(selectedParagraphs(EditorState.create({ doc, selection: TextSelection.create(doc, 2) })), null);
});
