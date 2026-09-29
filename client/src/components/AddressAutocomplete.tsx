import { useId } from "react";
import { PlacesAutocomplete } from "@/components/places-autocomplete";

// Preserve the structured callback consumed by the service-area editor.
interface AddressResult {
  place_id: number;
  lat: string;
  lon: string;
  display_name: string;
  address: { house_number?: string; road?: string; city?: string; town?: string; village?: string; state?: string; postcode?: string; country_code?: string };
}
interface Props {
  value: string;
  onChange(value: string): void;
  onBlur?(): void;
  placeholder?: string;
  error?: boolean;
  errorMessage?: string;
  label?: string;
  required?: boolean;
  className?: string;
  dark?: boolean;
  onSelect?(value: string, result: AddressResult): void;
  allowPlaceResults?: boolean;
}

export default function AddressAutocomplete({ value, onChange, onBlur, placeholder, error, errorMessage, label, required, className, dark = true, onSelect, allowPlaceResults = false }: Props) {
  const id = useId();
  return <div className={className}>
    {label && <label htmlFor={id} className={`mb-1 block text-xs font-semibold ${dark ? "text-zinc-400" : "text-zinc-600"}`}>{label} {required && <span className="text-red-400">*</span>}</label>}
    <PlacesAutocomplete
      id={id} value={value} onChange={onChange} onBlur={onBlur} placeholder={placeholder}
      required={required} allowPlaceResults={allowPlaceResults}
      aria-label={label || placeholder || "Street address"} aria-invalid={error || undefined}
      aria-describedby={error && errorMessage ? `${id}-error` : undefined}
      inputClassName={`${dark ? "bg-zinc-800 text-white placeholder:text-zinc-500" : "bg-white text-zinc-900 placeholder:text-zinc-400"} rounded-xl ${error ? "border-red-500" : dark ? "border-zinc-700" : "border-zinc-300"}`}
      onPlaceSelect={place => onSelect?.(place.fullAddress, {
        place_id: 0, lat: String(place.lat ?? ""), lon: String(place.lng ?? ""), display_name: place.fullAddress,
        address: { road: place.streetAddress, city: place.city, state: place.state, postcode: place.zip, country_code: "us" },
      })}
    />
    {error && errorMessage && <p id={`${id}-error`} className="mt-1 text-xs text-red-400">{errorMessage}</p>}
  </div>;
}
