export function matchingSlashCommands(text: string) {
  if (!/^\/[a-z ]*$/i.test(text)) return [];
  const query = text.slice(1).toLowerCase();
  return [
    {id: "code", label: "code block"},
    {id: "table", label: "table"},
  ].filter(command => command.label.startsWith(query)).map(command => command.id);
}
