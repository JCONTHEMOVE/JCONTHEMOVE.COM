export interface PlaceResult {
  fullAddress: string;
  streetAddress: string;
  city: string;
  state: string;
  zip: string;
  lat?: number;
  lng?: number;
}

interface AddressComponent { longText: string; shortText: string; types: string[] }
export interface AddressPlace {
  formattedAddress?: string;
  addressComponents?: AddressComponent[];
  location?: { lat(): number; lng(): number };
  fetchFields(options: { fields: string[] }): Promise<unknown>;
}
export interface AddressPrediction {
  placeId?: string;
  text: { toString(): string };
  toPlace(): AddressPlace;
}
interface PlacesLibrary {
  AutocompleteSessionToken: new () => object;
  AutocompleteSuggestion: {
    fetchAutocompleteSuggestions(options: {
      input: string;
      sessionToken: object;
      includedRegionCodes: string[];
      locationBias: { center: { lat: number; lng: number }; radius: number };
    }): Promise<{ suggestions: { placePrediction?: AddressPrediction }[] }>;
  };
}
type MapsWindow = Window & {
  google?: { maps?: { importLibrary?(name: string): Promise<PlacesLibrary> } };
  __jcAddressPlacesReady?: () => void;
};
let loading: Promise<PlacesLibrary> | undefined;

/** One lazy SDK load shared by every address field. Typing always works without it. */
export function loadAddressPlaces(): Promise<PlacesLibrary> {
  if (!loading) {
    loading = (async () => {
      const mapsWindow = window as MapsWindow;
      if (!mapsWindow.google?.maps?.importLibrary) {
        const response = await fetch("/api/maps-config", { signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error("Address search unavailable");
        const config = await response.json();
        if (!config.key || config.disabled) throw new Error("Address search unavailable");
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          const finish = (error?: Error) => {
            clearTimeout(timeout);
            delete mapsWindow.__jcAddressPlacesReady;
            script.onerror = null;
            if (error) { script.remove(); reject(error); } else resolve();
          };
          const timeout = window.setTimeout(() => finish(new Error("Address search timed out")), 8000);
          mapsWindow.__jcAddressPlacesReady = () => finish();
          script.dataset.jcGoogleMaps = "1";
          script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(config.key)}&loading=async&libraries=places&v=weekly&callback=__jcAddressPlacesReady`;
          script.async = true;
          script.onerror = () => finish(new Error("Address search unavailable"));
          document.head.appendChild(script);
        });
      }
      const library = await mapsWindow.google?.maps?.importLibrary?.("places");
      if (!library?.AutocompleteSuggestion || !library.AutocompleteSessionToken) throw new Error("Address search unavailable");
      return library;
    })().catch(error => { loading = undefined; throw error; });
  }
  return loading;
}

export function addressFromPlace(place: AddressPlace): PlaceResult {
  const parts = place.addressComponents || [];
  const component = (type: string, short = false) => {
    const part = parts.find(item => item.types.includes(type));
    return (short ? part?.shortText : part?.longText) || "";
  };
  const street = [component("street_number"), component("route")].filter(Boolean).join(" ");
  const unit = component("subpremise");
  const streetAddress = street ? street + (unit ? ` #${unit}` : "") : "";
  const city = component("locality") || component("postal_town") || component("sublocality_level_1") || component("sublocality") || component("administrative_area_level_3");
  const state = component("administrative_area_level_1", true);
  const zip = component("postal_code");
  return {
    fullAddress: place.formattedAddress || [streetAddress, city, state, zip].filter(Boolean).join(", "),
    streetAddress, city, state, zip,
    lat: place.location?.lat(), lng: place.location?.lng(),
  };
}
