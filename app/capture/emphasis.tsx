import { Fragment } from "react";

/**
 * Renders a dictionary value that wraps a phrase in `**double asterisks**` as <strong> (the sign-out sheets,
 * boards P2-07a/b). Anything without markers comes out as the plain text it is.
 */
export function Emphasis({ text }: { text: string }) {
  return (
    <>
      {text.split("**").map((part, i) =>
        i % 2 === 1 ? <strong key={i}>{part}</strong> : <Fragment key={i}>{part}</Fragment>,
      )}
    </>
  );
}
