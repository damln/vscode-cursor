export function matchingSlashCommands(
  text: string,
  extra: readonly { id: string; label: string }[] = [],
) {
  if (!/^\/[a-z ]*$/i.test(text)) return [];
  const query = text.slice(1).toLowerCase();
  return [
    { id: 'code', label: 'code block' },
    { id: 'table', label: 'table' },
    { id: 'list', label: 'list' },
    ...extra,
  ]
    .filter((command) => command.label.toLowerCase().startsWith(query))
    .map((command) => command.id);
}
