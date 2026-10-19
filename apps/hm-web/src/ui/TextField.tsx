import { useId, type InputHTMLAttributes } from "react";
import { cx } from "./cx";

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  error?: string | undefined;
}

export function TextField({ label, error, className, ...rest }: TextFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm text-white/70">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cx(
          "h-10 rounded-md border bg-surface px-3 text-sm text-white placeholder:text-white/30",
          "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white",
          error ? "border-brand" : "border-white/10",
          className,
        )}
        {...rest}
      />
      {error && (
        <p id={errorId} className="text-sm text-white/70">
          {error}
        </p>
      )}
    </div>
  );
}
