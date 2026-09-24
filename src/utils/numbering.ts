// Letter labels for tasks inside a section: 0 -> "a", 25 -> "z", 26 -> "aa".
export function taskLetter(index: number): string {
  let value = index;
  let label = '';
  do {
    label = String.fromCharCode(97 + (value % 26)) + label;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return label;
}
