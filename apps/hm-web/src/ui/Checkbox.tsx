import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "type"> {
  label: ReactNode;
}

export function Checkbox({ label, className, ...rest }: CheckboxProps) {
  const id = useId();
  return (
    <div className="flex items-start gap-2.5">
      <input
        id={id}
        type="checkbox"
        className={cx("mt-0.5 size-4 shrink-0 accent-brand", className)}
        {...rest}
      />
      <label htmlFor={id} className="text-sm text-white/80">
        {label}
      </label>
    </div>
  );
}
