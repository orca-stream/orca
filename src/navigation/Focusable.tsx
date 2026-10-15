import { useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import type { ComponentPropsWithoutRef, KeyboardEvent } from "react";

interface ButtonProps extends Omit<ComponentPropsWithoutRef<"button">, "onClick"> {
  /** Runs on click, tap, Enter or the gamepad's A button. Not used by submit buttons. */
  onPress?: () => void;
  /** Runs when the arrows land on the button, e.g. to scroll it into view. */
  onFocused?: (node: HTMLElement) => void;
  focusKey?: string;
}

/**
 * A button reachable with arrows. Enter never reaches the native button (the library swallows it),
 * so a submit button submits its form explicitly and every other button runs `onPress`.
 */
export function FocusButton({
  onPress,
  onFocused,
  focusKey,
  type = "button",
  ...props
}: ButtonProps) {
  const { ref } = useFocusable<object, HTMLButtonElement>({
    focusKey,
    onFocus: ({ node }) => onFocused?.(node),
    onEnterPress: () => {
      if (props.disabled) return;
      if (type === "submit") ref.current?.form?.requestSubmit();
      else onPress?.();
    },
  });
  return (
    <button ref={ref} type={type} onClick={type === "submit" ? undefined : onPress} {...props} />
  );
}

interface InputProps extends ComponentPropsWithoutRef<"input"> {
  focusKey?: string;
}

/** Keys a text field needs for itself: moving the caret, and Enter to submit its form. */
const TEXT_KEYS = new Set(["ArrowLeft", "ArrowRight", "Enter", "Home", "End"]);

/**
 * A text field reachable with arrows. Up/down still move between fields; left/right and Enter stay
 * in the field, so the caret moves and the form submits as usual.
 */
export function FocusInput({ focusKey, onKeyDown, ...props }: InputProps) {
  const { ref } = useFocusable<object, HTMLInputElement>({ focusKey });
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // React's handler runs at the root, before the library's listener on window.
    if (TEXT_KEYS.has(event.key)) event.stopPropagation();
    onKeyDown?.(event);
  }
  return <input ref={ref} onKeyDown={handleKeyDown} {...props} />;
}
