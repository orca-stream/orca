/** The two corners of a layout on the side facing the move, as the spatial library passes them. */
interface Corners {
  a: { x: number; y: number };
  b: { x: number; y: number };
}

/** Share of the narrower of the two nodes that has to overlap for the move to count as straight. */
const OVERLAP = 0.2;

/**
 * Whether `sibling` lies straight ahead of `ref` rather than diagonally. The library measures the
 * overlap against `ref` alone, so a small button centred under a wide row (the episodes' chevron)
 * never counts as straight ahead and any card in the next row wins over it. Measured against the
 * narrower of the two, a node that sits within the other's span is always straight ahead.
 */
export function isAdjacentSlice(ref: Corners, sibling: Corners, vertical: boolean): boolean {
  const axis = vertical ? "x" : "y";
  const refStart = Math.min(ref.a[axis], ref.b[axis]);
  const refEnd = Math.max(ref.a[axis], ref.b[axis]);
  const siblingStart = Math.min(sibling.a[axis], sibling.b[axis]);
  const siblingEnd = Math.max(sibling.a[axis], sibling.b[axis]);
  const overlap = Math.min(refEnd, siblingEnd) - Math.max(refStart, siblingStart);
  return overlap >= Math.min(refEnd - refStart, siblingEnd - siblingStart) * OVERLAP;
}
