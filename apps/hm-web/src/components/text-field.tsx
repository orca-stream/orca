import { useId, type ComponentProps } from "react";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

interface TextFieldProps extends Omit<ComponentProps<typeof Input>, "id"> {
  label: string;
  error?: string | undefined;
}

/** A labelled shadcn Input whose error, when there is one, is tied to it for screen readers. */
export function TextField({ label, error, ...rest }: TextFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...rest}
      />
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </Field>
  );
}
