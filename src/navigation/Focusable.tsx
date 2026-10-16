import { useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import type { ComponentPropsWithoutRef, KeyboardEvent } from "react";
import { caretCanMove } from "./caret";

/**
 * The library moves DOM focus without scrolling (see spatial.ts), so whatever the arrows land on is
 * brought into view here; on a 540px-tall TV page the last card of a list starts below the fold.
 */
function reveal(node: HTMLElement): void {
  node.scrollIntoView({ block: "nearest", inline: "nearest" });
}

interface ButtonProps extends Omit<ComponentPropsWithoutRef<"button">, "onClick"> {
  /** Runs on click, tap, Enter or the gamepad's A button. Not used by submit buttons. */
  onPress?: () => void;
  /** Runs when the arrows land on the button, in place of scrolling it just into view. */
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
    onFocus: ({ node }) => (onFocused ?? reveal)(node),
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
  /**
   * Runs when the arrows move on to something else; not on a DOM blur, which an on-screen keyboard
   * may cause.
   */
  onFocusLeave?: () => void;
}

/** Keys a text field needs for itself: moving the caret, and Enter to submit its form. */
const TEXT_KEYS = new Set(["ArrowLeft", "ArrowRight", "Enter", "Home", "End"]);

/**
 * A text field reachable with arrows. Up/down still move between fields; left/right and Enter stay
 * in the field, so the caret moves and the form submits as usual — until the caret is at that end.
 */
export function FocusInput({ focusKey, onKeyDown, onFocusLeave, ...props }: InputProps) {
  const { ref } = useFocusable<object, HTMLInputElement>({
    focusKey,
    onFocus: ({ node }) => reveal(node),
    onBlur: () => onFocusLeave?.(),
  });
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // React's handler runs at the root, before the library's listener on window.
    if (TEXT_KEYS.has(event.key) && caretCanMove(event.key, event.currentTarget)) {
      event.stopPropagation();
    }
    onKeyDown?.(event);
  }
  return <input ref={ref} onKeyDown={handleKeyDown} {...props} />;
}
