/**
 * Whether an arrow still has somewhere to move the caret. At either end it leaves the field instead,
 * or a remote could never get out of an empty search box sideways.
 */
export function caretCanMove(
  key: string,
  field: { value: string; selectionStart: number | null; selectionEnd: number | null },
): boolean {
  if (key === "ArrowLeft") return (field.selectionStart ?? 0) > 0;
  if (key === "ArrowRight") return (field.selectionEnd ?? field.value.length) < field.value.length;
  return true;
}
