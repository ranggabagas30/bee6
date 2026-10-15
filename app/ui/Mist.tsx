/**
 * Soft mint mist: pure decoration (aria-hidden, no pointer events, static, so nothing to reduce for
 * prefers-reduced-motion). Place it as the first child of a `position: relative` container and give the real
 * content `position: relative` so it paints above.
 */
export function Mist() {
  return (
    <div className="b6-mist" aria-hidden="true">
      <span className="b6-mist__leaf b6-mist__leaf--1" />
      <span className="b6-mist__leaf b6-mist__leaf--3" />
      <span className="b6-mist__leaf b6-mist__leaf--2" />
      <span className="b6-mist__leaf b6-mist__leaf--4" />
    </div>
  );
}
