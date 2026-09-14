const DEFAULT_PRIMARY_CHARSET = "acdefijklmnopqrsvwxz";
const ALL_ALLOWED_CHARSET = `${DEFAULT_PRIMARY_CHARSET}bghtuy1234905678`;
const DEFAULT_WORD_REGEXP = "[\\wА-яЁё]{2,}";
const DEFAULT_WORD_END_REGEXP = "(?<=[\\wА-яЁё]{2})(\\b|-|\\s|,|\\.)";
const DEFAULT_WORD_REGEXP_FLAGS = "gi";
const DEFAULT_COLOR = "#0af0c1";
const DEFAULT_BACKGROUND_COLOR = "#004455";

function combineElements(left, right, output) {
  const combinations = [];
  for (let i = 0; i < left.length; i += 1) {
    for (let j = 0; j < right.length; j += 1) {
      combinations.push({ text: left[i] + right[j], i, j, weight: i + j });
    }
  }
  combinations
    .sort((a, b) => a.weight - b.weight || a.i - b.i || a.j - b.j)
    .forEach(combination => output.push(combination.text));
}

function createJumpCodeSet(primaryCharset = DEFAULT_PRIMARY_CHARSET) {
  const primary = [...String(primaryCharset).toLowerCase()].filter(
    (character, index, characters) =>
      ALL_ALLOWED_CHARSET.includes(character) && characters.indexOf(character) === index
  );
  const effectivePrimary = primary.length ? primary : [...DEFAULT_PRIMARY_CHARSET];
  const secondary = [...ALL_ALLOWED_CHARSET].filter(
    character => !effectivePrimary.includes(character)
  );
  const codes = [];
  combineElements(effectivePrimary, effectivePrimary, codes);
  combineElements(effectivePrimary, secondary, codes);
  combineElements(secondary, secondary, codes);
  return codes;
}

module.exports = {
  ALL_ALLOWED_CHARSET,
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_COLOR,
  DEFAULT_PRIMARY_CHARSET,
  DEFAULT_WORD_END_REGEXP,
  DEFAULT_WORD_REGEXP,
  DEFAULT_WORD_REGEXP_FLAGS,
  createJumpCodeSet
};
