import { useState } from "react";
import { FocusInput } from "../navigation/Focusable";

interface BoxesProps {
  value: string;
  length?: number;
  /** The box the next digit goes in, drawn with a caret; -1 when nothing is being typed. */
  active?: number;
  /** `lg` for a code read from across the room on a TV. */
  size?: "md" | "lg";
}

const BOX = {
  md: "h-16 max-w-14 rounded-xl text-3xl",
  lg: "h-20 max-w-16 rounded-2xl text-4xl",
};

/** A one-time code as separate boxes, split in two halves like Netflix's TV codes: 482 913. */
export function CodeBoxes({ value, length = 6, active = -1, size = "md" }: BoxesProps) {
  const half = Math.ceil(length / 2);
  return (
    <span aria-hidden="true" className="flex w-full justify-center gap-2">
      {Array.from({ length }, (_, index) => {
        const digit = value[index];
        const current = index === active;
        return (
          <span
            key={index}
            className={`relative grid flex-1 place-items-center bg-white/[0.07] font-semibold tabular-nums ring-1 transition-shadow ${BOX[size]} ${
              current ? "ring-2 ring-white" : digit ? "ring-white/40" : "ring-white/15"
            } ${index === half ? "ml-3" : ""}`}
          >
            {digit}
            {current && !digit && (
              <span className="absolute h-1/2 w-0.5 animate-pulse rounded-full bg-white" />
            )}
          </span>
        );
      })}
    </span>
  );
}

interface InputProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  length?: number;
  focusKey?: string;
}

/**
 * Types a one-time code into {@link CodeBoxes}. One real field lies invisible over the boxes, so
 * pasting, the SMS autofill, the numeric keyboard and deleting all behave as in any text field.
 */
export function CodeInput({ value, onChange, label, length = 6, focusKey }: InputProps) {
  const [focused, setFocused] = useState(false);
  return (
    <span className="relative flex">
      <CodeBoxes
        value={value}
        length={length}
        active={focused ? Math.min(value.length, length - 1) : -1}
      />
      <FocusInput
        focusKey={focusKey}
        aria-label={label}
        className="absolute inset-0 size-full cursor-text opacity-0"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d*"
        maxLength={length}
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, length))}
        onFocus={(event) => {
          setFocused(true);
          // The caret always goes after the last digit, the box drawn as active.
          const end = event.target.value.length;
          event.target.setSelectionRange(end, end);
        }}
        onBlur={() => setFocused(false)}
      />
    </span>
  );
}
