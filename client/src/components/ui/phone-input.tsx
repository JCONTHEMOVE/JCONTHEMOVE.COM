import * as React from "react";
import { formatPhoneEntry, phoneDigits, phoneError, unchangedLegacyPhone } from "@shared/phone";

export type PhoneInputProps = React.ComponentProps<"input"> & { legacyPhoneValue?: string | null };

export const PhoneInput = React.forwardRef<HTMLInputElement, PhoneInputProps>(function PhoneInput(
  { value, defaultValue, onChange, onBlur, onInvalid, required, legacyPhoneValue, id, ...props }, forwardedRef,
) {
  const generatedId = React.useId();
  const inputId = id || generatedId;
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [localValue, setLocalValue] = React.useState(String(defaultValue ?? ""));
  const [touched, setTouched] = React.useState(false);
  const raw = String(value ?? localValue);
  const display = formatPhoneEntry(raw);
  const legacy = unchangedLegacyPhone(display, legacyPhoneValue);
  const error = phoneError(display, !!required);
  const helperId = `${inputId}-phone-help`;
  const errorId = `${inputId}-phone-error`;

  React.useEffect(() => {
    inputRef.current?.setCustomValidity(legacy ? "" : error || "");
  }, [error, legacy]);

  // Form libraries can reset uncontrolled inputs through the forwarded ref.
  React.useLayoutEffect(() => {
    if (value === undefined && inputRef.current && inputRef.current.value !== display) {
      setLocalValue(inputRef.current.value);
    }
  });

  return (
    <div className="min-w-0 w-full space-y-1">
      <input
        {...props}
        id={inputId}
        data-customer-phone="true"
        ref={(element) => {
          inputRef.current = element;
          if (typeof forwardedRef === "function") forwardedRef(element);
          else if (forwardedRef) forwardedRef.current = element;
        }}
        type="tel"
        inputMode="tel"
        autoComplete={props.autoComplete ?? "tel"}
        aria-label={props["aria-label"]}
        aria-describedby={[props["aria-describedby"], helperId, (touched && error) || legacy ? errorId : ""].filter(Boolean).join(" ")}
        aria-invalid={touched && !!error && !legacy ? true : props["aria-invalid"]}
        placeholder="906-555-0123"
        required={required && !legacy}
        value={value === undefined ? undefined : display}
        defaultValue={value === undefined ? formatPhoneEntry(String(defaultValue ?? "")) : undefined}
        onFocus={(event) => { if (value === undefined) setLocalValue(event.currentTarget.value); props.onFocus?.(event); }}
        onKeyDown={(event) => {
          props.onKeyDown?.(event);
          const element = event.currentTarget;
          const start = element.selectionStart ?? 0;
          if (!event.defaultPrevented && event.key === "Backspace" && start === element.selectionEnd && element.value[start - 1] === "-") {
            // Select the preceding digit with the separator so native deletion
            // cannot get stuck repeatedly removing an automatically added hyphen.
            element.setSelectionRange(start - 2, start);
          }
        }}
        onChange={(event) => {
          const element = event.currentTarget;
          const entered = element.value;
          const caret = element.selectionStart ?? entered.length;
          const digitsBefore = entered.slice(0, caret).replace(/\D/g, "").length;
          const formatted = formatPhoneEntry(entered);
          element.value = formatted;
          setLocalValue(formatted);
          element.setCustomValidity(unchangedLegacyPhone(formatted, legacyPhoneValue) ? "" : phoneError(formatted, !!required) || "");
          onChange?.(event);
          // Map the caret by digits, not punctuation, when inserting or replacing text.
          let nextCaret = caret;
          if (formatted !== entered) {
            let seen = 0;
            nextCaret = 0;
            while (nextCaret < formatted.length && seen < digitsBefore) {
              if (/\d/.test(formatted[nextCaret])) seen++;
              nextCaret++;
            }
          }
          requestAnimationFrame(() => {
            if (document.activeElement === element) element.setSelectionRange(nextCaret, nextCaret);
          });
        }}
        onBlur={(event) => { setTouched(true); onBlur?.(event); }}
        onInvalid={(event) => { setTouched(true); onInvalid?.(event); }}
      />
      <p id={helperId} className="text-xs text-muted-foreground">
        Area code + phone number · {phoneDigits(display).length} of 10 digits
        {!error && display && <span className="block">Complete number: {display}. Please double-check this is the best number to reach you.</span>}
      </p>
      {legacy ? <p id={errorId} className="text-xs text-amber-500">This saved number needs correction. You can still save unrelated job changes.</p>
        : touched && error ? <p id={errorId} role="alert" className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
});
