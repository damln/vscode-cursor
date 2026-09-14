const test = require('node:test');
const assert = require('node:assert/strict');
const {findHexColors} = require('../extensions/markdown-inline/color-preview');
test('finds hex colors in prose and CSS without requiring inline code', () => {
 const text='Primary (#FAFF69), #e6eb52; color: #abc; #abcd #11223344 #00000000';
 assert.deepEqual(findHexColors(text).map(v=>v.color),['#faff69','#e6eb52','#abc','#abcd','#11223344','#00000000']);
 for(const item of findHexColors(text)) assert.equal(text.slice(item.from,item.to).toLowerCase(),item.color);
});
test('does not treat partial hex, identifiers or URL fragments as colors', () => {
 for(const text of ['#12','#12345','#1234567','#123456789','#abcdefg','token#fff','#fff-token','https://example.com/#fff','page.md#abcdef','?color=#fff'])assert.deepEqual(findHexColors(text),[],text);
});
test('keeps editor sentinels out of the color value without changing model offsets', () => {
 assert.deepEqual(findHexColors('a \u200b#f\u200bff\ufeff!'),[{from:3,to:9,color:'#fff'}]);
});
