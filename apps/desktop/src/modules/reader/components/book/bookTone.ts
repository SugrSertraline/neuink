export function bookTone(id: string) {
  return [...id].reduce((sum, character) => (sum * 31 + character.charCodeAt(0)) >>> 0, 0) % 6;
}
