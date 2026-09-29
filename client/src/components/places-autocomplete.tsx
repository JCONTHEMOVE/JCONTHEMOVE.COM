import { forwardRef, useEffect, useId, useRef, useState, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { addressFromPlace, loadAddressPlaces, type AddressPrediction, type PlaceResult } from "@/lib/address-places";

export type { PlaceResult } from "@/lib/address-places";
interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onSelect"> {
  value: string;
  onChange(value: string): void;
  onPlaceSelect?(place: PlaceResult): void;
  inputClassName?: string;
  inputTestId?: string;
  "data-testid"?: string;
  addressValue?: "full" | "street";
  allowPlaceResults?: boolean;
  suggestionPlacement?: "above" | "below";
  disableGoogle?: boolean;
  /** Kept for existing callers; only an explicit suggestion selection changes an address. */
  resolveOnBlur?: boolean;
  onResolveAttempt?(success: boolean): void;
}

export const PlacesAutocomplete = forwardRef<HTMLInputElement, Props>(function PlacesAutocomplete({
  value, onChange, onPlaceSelect, inputClassName, inputTestId, className,
  addressValue = "full", allowPlaceResults = false, disableGoogle = false,
  suggestionPlacement = "below",
  resolveOnBlur: _resolveOnBlur, onResolveAttempt, onFocus, onBlur, onKeyDown,
  id, disabled, readOnly, placeholder = "Start typing an address", autoComplete = "street-address",
  "data-testid": dataTestId,
  ...inputProps
}, ref) {
  const generatedId = useId();
  const inputId = id || `address-${generatedId}`;
  const listId = `${inputId}-suggestions`;
  const statusId = `${inputId}-status`;
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [suggestions, setSuggestions] = useState<AddressPrediction[]>([]);
  const [active, setActive] = useState(-1);
  const [status, setStatus] = useState<"idle" | "loading" | "selecting" | "empty" | "incomplete" | "unavailable">("idle");
  const querySequence = useRef(0);
  const selectionSequence = useRef(0);
  const session = useRef<object>();
  const selectedValue = useRef<string>();
  const previousValue = useRef(value);
  const alive = useRef(true);
  const latest = useRef({ onChange, onPlaceSelect, onResolveAttempt, value, disabled, readOnly });
  latest.current = { onChange, onPlaceSelect, onResolveAttempt, value, disabled, readOnly };
  // A parent reset is just as significant as typing; never apply late place details to it.
  if (previousValue.current !== value) {
    previousValue.current = value;
    selectionSequence.current++;
  }
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; querySequence.current++; selectionSequence.current++; };
  }, []);
  useEffect(() => { setStatus("idle"); }, [value]);
  useEffect(() => { selectionSequence.current++; setStatus("idle"); }, [disabled, readOnly, disableGoogle]);

  useEffect(() => {
    const request = ++querySequence.current;
    setSuggestions([]);
    setActive(-1);
    if (!value.trim()) session.current = undefined;
    if (dismissed && !disabled && !readOnly && !disableGoogle) return;
    if (!focused || disabled || readOnly || disableGoogle || value.trim().length < 3 || value === selectedValue.current) {
      setStatus("idle");
      return;
    }
    setStatus("idle");
    const timer = window.setTimeout(async () => {
      setStatus("loading");
      try {
        const library = await loadAddressPlaces();
        if (request !== querySequence.current) return;
        session.current ||= new library.AutocompleteSessionToken();
        const result = await library.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: value.trim(), sessionToken: session.current, includedRegionCodes: ["us"],
          locationBias: { center: { lat: 46.4547, lng: -90.171 }, radius: 50000 },
        });
        if (request !== querySequence.current) return;
        const matches = result.suggestions.flatMap(item => item.placePrediction ? [item.placePrediction] : []).slice(0, 5);
        setSuggestions(matches);
        setStatus(matches.length ? "idle" : "empty");
      } catch {
        if (request === querySequence.current) { setStatus("unavailable"); latest.current.onResolveAttempt?.(false); }
      }
    }, 300);
    return () => { clearTimeout(timer); querySequence.current++; };
  }, [value, focused, dismissed, disabled, readOnly, disableGoogle]);

  async function select(prediction: AddressPrediction) {
    const request = ++selectionSequence.current;
    querySequence.current++;
    setDismissed(true);
    setSuggestions([]);
    setActive(-1);
    setStatus("selecting");
    try {
      const place = prediction.toPlace();
      session.current = undefined;
      await place.fetchFields({ fields: ["formattedAddress", "addressComponents", "location"] });
      if (!alive.current || request !== selectionSequence.current || latest.current.disabled || latest.current.readOnly) return;
      const result = addressFromPlace(place);
      if (!result.fullAddress) throw new Error("Choose a street address");
      const hasStreetNumber = place.addressComponents?.some(part => part.types.includes("street_number") && part.longText);
      if (!allowPlaceResults && (!result.streetAddress || !hasStreetNumber)) {
        setStatus("incomplete");
        latest.current.onResolveAttempt?.(false);
        return;
      }
      const nextValue = addressValue === "street" ? result.streetAddress : result.fullAddress;
      selectedValue.current = nextValue;
      session.current = undefined;
      latest.current.onChange(nextValue);
      latest.current.onPlaceSelect?.(result);
      latest.current.onResolveAttempt?.(true);
      setStatus("idle");
    } catch {
      if (alive.current && request === selectionSequence.current) {
        setStatus("unavailable");
        latest.current.onResolveAttempt?.(false);
      }
    }
  }

  const open = focused && !dismissed && !disabled && !readOnly && suggestions.length > 0;
  useEffect(() => {
    if (open && active >= 0) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, listId]);
  const message = status === "loading" ? "Finding addresses…"
    : status === "selecting" ? "Filling address…"
    : status === "empty" ? "No suggestions found. You can enter the full address manually."
    : status === "incomplete" ? "Include the street number and full address, or complete it manually."
    : status === "unavailable" ? "Address suggestions are unavailable. You can enter the address manually." : "";
  return <div className={cn("relative w-full", className)}>
    <input
      {...inputProps} ref={ref} id={inputId} type="text" value={value}
      disabled={disabled} readOnly={readOnly} placeholder={placeholder} autoComplete={autoComplete}
      data-testid={inputTestId || dataTestId}
      className={cn("flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50", inputClassName)}
      role="combobox" aria-autocomplete="list" aria-expanded={open}
      aria-controls={open ? listId : undefined} aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
      aria-describedby={[inputProps["aria-describedby"], message ? statusId : ""].filter(Boolean).join(" ") || undefined}
      onChange={event => {
        selectionSequence.current++;
        querySequence.current++;
        selectedValue.current = undefined;
        setDismissed(false); setStatus("idle"); setSuggestions([]); setActive(-1);
        onChange(event.target.value);
      }}
      onFocus={event => { setFocused(true); setDismissed(false); onFocus?.(event); }}
      onBlur={event => {
        querySequence.current++;
        session.current = undefined;
        setFocused(false); setSuggestions([]); setActive(-1);
        onBlur?.(event);
        if (value.trim() && value !== selectedValue.current) onResolveAttempt?.(false);
      }}
      onKeyDown={event => {
        if (!event.nativeEvent.isComposing && status === "selecting" && event.key === "Enter") { event.preventDefault(); return; }
        if (!event.nativeEvent.isComposing && open) {
          if (event.key === "ArrowDown") { event.preventDefault(); setActive(index => (index + 1) % suggestions.length); return; }
          if (event.key === "ArrowUp") { event.preventDefault(); setActive(index => index <= 0 ? suggestions.length - 1 : index - 1); return; }
          if (event.key === "Enter") { event.preventDefault(); if (active >= 0) void select(suggestions[active]); return; }
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDismissed(true); return; }
        }
        onKeyDown?.(event);
      }}
    />
    {open && <div className={cn("absolute z-[100] w-full overflow-hidden rounded-md border border-slate-300 bg-white text-slate-900 shadow-xl", suggestionPlacement === "above" ? "bottom-full mb-1" : "top-full mt-1")}>
      <ul id={listId} role="listbox" aria-label="Address suggestions" className="max-h-60 overflow-y-auto">
        {suggestions.map((prediction, index) => <li
          id={`${listId}-${index}`} key={prediction.placeId || `${index}-${prediction.text}`}
          role="option" aria-selected={index === active}
          className={cn("cursor-pointer px-3 py-3 text-sm hover:bg-slate-100", index === active && "bg-slate-100")}
          onMouseDown={event => event.preventDefault()}
          onClick={() => void select(prediction)}
        >{prediction.text.toString()}</li>)}
      </ul>
      <div translate="no" className="border-t border-slate-200 px-3 py-2 text-right" style={{ color: "#5e5e5e", fontFamily: "Arial, sans-serif", fontWeight: 400, fontSize: 12 }}>Google Maps</div>
    </div>}
    {message && <p id={statusId} role="status" className="mt-1 text-xs text-muted-foreground">{message}</p>}
  </div>;
});
