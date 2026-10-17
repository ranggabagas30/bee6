import type { ReactNode } from "react";

/**
 * Bold the first occurrence of `word` inside an already translated sentence ("recorded as unverified"), so a
 * translation never has to carry markup. No match (a translator reworded it): the sentence renders plain.
 */
export function emphasize(text: string, word: string): ReactNode {
  const at = word.length > 0 ? text.indexOf(word) : -1;
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <strong>{word}</strong>
      {text.slice(at + word.length)}
    </>
  );
}
