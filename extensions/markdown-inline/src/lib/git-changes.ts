import { diffLines } from 'diff';

export interface GitChange {
  kind: 'added' | 'modified' | 'deleted';
  from: number;
  to: number;
  added: number;
  removed: number;
}

/** Offsets refer to the authored document, including CRLF and frontmatter. */
export function gitChanges(baseline: string, text: string): GitChange[] {
  const parts = diffLines(baseline.replace(/\r\n?/g, '\n'), text.replace(/\r\n?/g, '\n'), {timeout: 40});
  if (!parts) return [];
  const starts = [0];
  for (const match of text.matchAll(/\r\n|\r|\n/g)) starts.push(match.index! + match[0].length);
  const offset = (line: number) => starts[line] ?? text.length;
  const changes: GitChange[] = [];
  let line = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part.added && !part.removed) { line += part.count; continue; }
    const from = offset(line);
    let added = 0, removed = 0;
    while (i < parts.length && (parts[i].added || parts[i].removed)) {
      if (parts[i].added) added += parts[i].count;
      else removed += parts[i].count;
      i++;
    }
    i--;
    line += added;
    changes.push({kind: added ? (removed ? 'modified' : 'added') : 'deleted',
      from, to: offset(line), added, removed});
  }
  return changes;
}
