import { useEffect, useRef, useState } from "react";

export type ProjectAddress = { street: string; city: string; state: string; zip: string };
type AddressComponent = { longText: string; shortText: string; types: string[] };
type PlaceResult = { formattedAddress?: string; addressComponents?: AddressComponent[]; fetchFields: (options: { fields: string[] }) => Promise<unknown> };
type PlaceSelectEvent = Event & { placePrediction: { toPlace: () => PlaceResult } };
type PlacesWidget = HTMLElement;
type PlacesWindow = Window & { __jcProjectPlacesReady?: () => void; google?: { maps?: { importLibrary?: (name: string) => Promise<{ PlaceAutocompleteElement: new (options: object) => PlacesWidget }> } } };
let placesLoading: Promise<new (options: object) => PlacesWidget> | undefined;

async function loadPlaces() {
  if (!placesLoading) {
    placesLoading = (async () => {
      const config = await fetch("/api/maps-config?client=project-request").then(response => {
        if (!response.ok) throw new Error("Address search unavailable");
        return response.json();
      });
      if (!config.key || config.disabled) throw new Error("Address search unavailable");
      const mapsWindow = window as PlacesWindow;
      if (!mapsWindow.google?.maps?.importLibrary) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          const timeout = window.setTimeout(() => reject(new Error("Address search timed out")), 12000);
          mapsWindow.__jcProjectPlacesReady = () => { clearTimeout(timeout); delete mapsWindow.__jcProjectPlacesReady; resolve(); };
          script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(config.key)}&loading=async&libraries=places&v=weekly&callback=__jcProjectPlacesReady`;
          script.async = true;
          script.onerror = () => { clearTimeout(timeout); delete mapsWindow.__jcProjectPlacesReady; script.remove(); reject(new Error("Address search unavailable")); };
          document.head.appendChild(script);
        });
      }
      const library = await mapsWindow.google?.maps?.importLibrary?.("places");
      if (!library?.PlaceAutocompleteElement) throw new Error("Address search unavailable");
      return library.PlaceAutocompleteElement;
    })().catch(error => { placesLoading = undefined; throw error; });
  }
  return placesLoading;
}

export function ProjectAddressField({ value, onChange }: { value: ProjectAddress; onChange: (value: ProjectAddress) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [manual, setManual] = useState(!!value.street);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const [searching, setSearching] = useState(!value.street);
  useEffect(() => {
    if (!searching) return;
    let cancelled = false;
    let widget: PlacesWidget | undefined;
    // A blocked third-party script never blocks manual entry.
    const timeout = window.setTimeout(() => {
      if (!cancelled) { setStatus("unavailable"); setManual(true); }
    }, 8000);
    loadPlaces().then(Widget => {
      if (cancelled || !container.current) return;
      clearTimeout(timeout);
      widget = new Widget({ includedRegionCodes: ["us"], locationBias: { center: { lat: 46.4547, lng: -90.171 }, radius: 100000 } });
      widget.setAttribute("placeholder", "Start typing your project address");
      widget.setAttribute("aria-label", "Find your project address");
      widget.addEventListener("gmp-select", async rawEvent => {
        try {
          const place = (rawEvent as PlaceSelectEvent).placePrediction.toPlace();
          await place.fetchFields({ fields: ["addressComponents", "formattedAddress"] });
          if (cancelled) return;
          const components = place.addressComponents || [];
          const component = (type: string, short = false) => {
            const found = components.find(part => part.types.includes(type));
            return (short ? found?.shortText : found?.longText) || "";
          };
          const street = [component("street_number"), component("route")].filter(Boolean).join(" ");
          onChangeRef.current({ street, city: component("locality") || component("postal_town") || component("sublocality_level_1") || component("administrative_area_level_3"), state: component("administrative_area_level_1", true), zip: component("postal_code") });
          setManual(true);
          setSearching(false);
        } catch { if (!cancelled) { setStatus("unavailable"); setManual(true); } }
      });
      widget.addEventListener("gmp-error", () => { if (!cancelled) { setStatus("unavailable"); setManual(true); } });
      container.current.replaceChildren(widget);
      setStatus("ready");
    }).catch(() => { if (!cancelled) { clearTimeout(timeout); setStatus("unavailable"); setManual(true); } });
    return () => { cancelled = true; clearTimeout(timeout); widget?.remove(); };
  }, [searching]);

  return <div className="jc-address">
    {searching && <><p className="jc-field">Find your pickup or project address</p><div className="jc-address-search" ref={container} />{status === "loading" && <p className="jc-form-help" role="status">Loading address suggestions… You can also enter your address below.</p>}{status === "unavailable" && <p className="jc-form-help" role="status">Address search is unavailable. Enter your address below to continue.</p>}</>}
    {!manual && <button type="button" className="jc-address-manual" onClick={() => { setManual(true); setSearching(false); }}>Enter address manually</button>}
    {manual && <>
      <label className="jc-field">Street address<input autoComplete="street-address" value={value.street} maxLength={350} onChange={event => onChange({ ...value, street: event.target.value })} placeholder="123 Main Street, Apt 2" /></label>
      <div className="jc-address-row"><label className="jc-field">City<input autoComplete="address-level2" value={value.city} maxLength={100} onChange={event => onChange({ ...value, city: event.target.value })} /></label><label className="jc-field">State<input autoComplete="address-level1" value={value.state} maxLength={2} placeholder="MI" onChange={event => onChange({ ...value, state: event.target.value.toUpperCase() })} /></label><label className="jc-field">ZIP code<input autoComplete="postal-code" inputMode="numeric" maxLength={10} value={value.zip} onChange={event => onChange({ ...value, zip: event.target.value })} /></label></div>
      {!searching && <button type="button" className="jc-address-manual" onClick={() => { setStatus("loading"); setSearching(true); }}>Find an address with Google</button>}
    </>}
  </div>;
}
