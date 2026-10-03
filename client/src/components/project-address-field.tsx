import { useId } from "react";
import { PlacesAutocomplete } from "@/components/places-autocomplete";

export type ProjectAddress = { street: string; city: string; state: string; zip: string };

export function ProjectAddressField({ value, onChange }: { value: ProjectAddress; onChange(value: ProjectAddress): void }) {
  const id = useId();
  return <div className="jc-address">
    <div className="jc-field">
      <label htmlFor={id}>Street address</label>
      <PlacesAutocomplete
        id={id} autoComplete="street-address" value={value.street} addressValue="street" maxLength={350}
        onChange={street => onChange({ ...value, street })}
        onPlaceSelect={place => onChange({ street: place.streetAddress, city: place.city, state: place.state, zip: place.zip })}
        placeholder="Start typing your project address"
        inputClassName="bg-white text-slate-900"
      />
    </div>
    <div className="jc-address-row">
      <label className="jc-field">City<input autoComplete="address-level2" value={value.city} maxLength={100} onChange={event => onChange({ ...value, city: event.target.value })} /></label>
      <label className="jc-field">State<input autoComplete="address-level1" value={value.state} maxLength={2} placeholder="MI" onChange={event => onChange({ ...value, state: event.target.value.toUpperCase() })} /></label>
      <label className="jc-field">ZIP code<input autoComplete="postal-code" inputMode="numeric" maxLength={10} value={value.zip} onChange={event => onChange({ ...value, zip: event.target.value })} /></label>
    </div>
    <p className="jc-form-help">Choose a suggestion to fill city, state, and ZIP, or enter the address manually. Add apartment or unit details to the street address.</p>
  </div>;
}
