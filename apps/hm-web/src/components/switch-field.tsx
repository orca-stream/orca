import { useId } from "react";
import { Field, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";

interface SwitchFieldProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}

/** A shadcn Switch with its label beside it. */
export function SwitchField({ checked, onCheckedChange, label, disabled }: SwitchFieldProps) {
  const id = useId();
  return (
    <Field orientation="horizontal" data-disabled={disabled || undefined}>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={(next) => onCheckedChange(next)}
        {...(disabled === undefined ? {} : { disabled })}
      />
      <FieldLabel htmlFor={id} className="font-normal">
        {label}
      </FieldLabel>
    </Field>
  );
}
