const vscode = require("vscode");
const { createSkill } = require("./create-skill");

function activate(context) {
  context.subscriptions.push(vscode.commands.registerCommand(
    "damlnMinimalTheme.createSkill", () => createSkill(vscode)
  ));
}

module.exports = { activate };
