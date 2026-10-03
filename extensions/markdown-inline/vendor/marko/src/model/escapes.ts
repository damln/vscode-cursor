// The Markdown writer escapes characters defensively, so notes get `PG\_JOBS`,
// `https\://`, `user\@host`, `\~/path` or `\[NOTE]`. This keeps only the escapes
// that change how the text is read back.

const WORD = /[\p{L}\p{N}]/u

/** Strikethrough needs a tilde that can open (text after it) before one that can close (text before it). */
function canStrike(value: string): boolean {
  let opener = false
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== '~') continue
    if (opener && /\S/.test(value[i - 1] ?? '')) return true
    if (/\S/.test(value[i + 1] ?? '')) opener = true
  }
  return false
}

/**
 * `escaped` is the writer's output for a text node whose raw text is `value`.
 * An escaped backslash (`\\`) is always kept.
 */
export function relaxEscapes(escaped: string, value: string): string {
  const strike = canStrike(value)
  // `]` followed by `(`, `[` or `:` could form a link or a link definition.
  const linkLike = /\][ \t]*[([:]/.test(value)
  return escaped.replace(/\\\\|\\([_:@~[.])/g, (match: string, char: string | undefined, offset: number, whole: string) => {
    const before = whole[offset - 1] ?? ''
    const after = whole.slice(offset + 2)
    switch (char) {
      // Underscores inside a word never start emphasis.
      case '_': return WORD.test(before) && WORD.test(after[0] ?? '') ? '_' : match
      // Only escaped so a URL or an email typed as text is not read back as a link. A link is fine.
      case ':': case '@': return char
      case '.': return /[Ww]/.test(before) ? '.' : match
      case '~': return strike ? match : '~'
      case '[': return linkLike || /^[ xX]\]/.test(after) ? match : '['
      default: return match
    }
  })
}
