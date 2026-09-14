import assert from "node:assert/strict";
import test from "node:test";
import { Editor, remarkCtx, remarkPluginsCtx } from "@milkdown/kit/core";
import { remarkGFMPlugin } from "@milkdown/kit/preset/gfm";

async function processor() {
  const ctx = Editor.make().ctx;
  ctx.inject(remarkCtx).inject(remarkPluginsCtx, []);
  ctx.inject(remarkGFMPlugin.options.key, { tablePipeAlign: false });
  // No DOM editor is needed to exercise Milkdown's real remark serializer.
  ctx.wait = async () => {};
  await remarkGFMPlugin.plugin(ctx)();
  return ctx.get(remarkPluginsCtx).reduce(
    (remark, entry) => remark.use(entry.plugin, entry.options), ctx.get(remarkCtx)()
  );
}

test("editing a cell does not widen other cells or separator dashes", async () => {
  const remark = await processor();
  const source = "| Input | Required | Meaning |\n| --- | --- | --- |\n| mode | no | default |\n";
  const tree = remark.parse(source);
  const table = tree.children[0];
  if (table.type !== "table") throw new Error("Expected a parsed table");
  const text = table.children[1].children[2].children[0];
  if (text.type !== "text") throw new Error("Expected cell text");
  text.value = "A much longer description of the default mode";
  const result = remark.stringify(tree);
  assert.equal(result, source
    .replace("default", "A much longer description of the default mode")
    .replace("| --- | --- | --- |", "| - | - | - |"));
  assert.equal(remark.stringify(remark.parse(result)), result);
});

test("compact tables retain alignment, escaped pipes, and inline code", async () => {
  const remark = await processor();
  const source = "| Left | Center | Right |\n| :- | :-: | -: |\n| a\\|b | `mode` | **yes** |\n";
  assert.equal(remark.stringify(remark.parse(source)), source);
});
