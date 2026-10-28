// Safe to send before reveal: lyric letters become anonymous slots.
// Only punctuation and whitespace survive as visible formatting hints.
export function createLyricLayout(lines) {
  return lines.map(line => Array.from(line).flatMap(character => {
    if (/\p{P}/u.test(character)) return [{ type: 'punctuation', text: character }];
    if (/[\p{Z}\s]/u.test(character)) return [{ type: 'space', text: character }];
    if (/\p{C}/u.test(character)) return [];
    return Array.from(character.normalize('NFKC')).flatMap(normalized => {
      if (/\p{P}/u.test(normalized)) return [{ type: 'punctuation', text: normalized }];
      if (/[\p{Z}\s]/u.test(normalized)) return [{ type: 'space', text: normalized }];
      if (/\p{C}/u.test(normalized)) return [];
      return [{ type: 'slot' }];
    });
  }));
}
