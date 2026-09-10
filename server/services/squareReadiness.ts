import { getSquareAccessToken, getSquareEnvironment, getSquareLocationId } from './squareConfig';

type Location = { id?: string; status?: string };

export async function verifySquareReadiness(input: {
  environment: string | undefined;
  productionHost: boolean;
  tokenConfigured: boolean;
  locationId: string | null;
  listLocations: () => Promise<{ locations?: Location[] }>;
}): Promise<{ ok: boolean; detail: string }> {
  if (!['sandbox', 'production'].includes(input.environment || '')) {
    return { ok: false, detail: 'Set an explicit Square environment: sandbox or production' };
  }
  if (input.productionHost && input.environment !== 'production') {
    return { ok: false, detail: 'Production launch requires Square production; sandbox is not live payment readiness' };
  }
  if (!input.tokenConfigured) return { ok: false, detail: 'Square token is missing for the active environment' };
  try {
    // Always contact Square, even when a location ID is configured or cached.
    const response = await input.listLocations();
    const locations = response.locations || [];
    const selected = input.locationId ? locations.find(location => location.id === input.locationId) : locations[0];
    if (!selected?.id) return { ok: false, detail: 'Square authenticated, but the invoice location is missing or inaccessible' };
    if (selected.status !== 'ACTIVE') return { ok: false, detail: 'Square authenticated, but the invoice location is not active' };
    return { ok: true, detail: `environment=${input.environment}; Square authenticated and invoice location is active; invoice/payment acceptance still required` };
  } catch (error) {
    const status = Number((error as { statusCode?: unknown })?.statusCode);
    const suffix = Number.isInteger(status) && status >= 400 && status <= 599 ? ` (HTTP ${status})` : '';
    // Provider errors can carry request headers/bodies. Never echo them here.
    return { ok: false, detail: `Square authentication/location request failed${suffix}; verify credentials, environment and connectivity` };
  }
}

export async function probeSquareReadiness() {
  return verifySquareReadiness({
    environment: process.env.SQUARE_ENVIRONMENT,
    productionHost: process.env.NODE_ENV === 'production',
    tokenConfigured: Boolean(getSquareAccessToken()),
    locationId: getSquareLocationId(),
    listLocations: async () => {
      const { SquareClient, SquareEnvironment } = await import('square');
      const client = new SquareClient({ token: getSquareAccessToken(),
        environment: getSquareEnvironment() === 'production' ? SquareEnvironment.Production : SquareEnvironment.Sandbox });
      return client.locations.list({ timeoutInSeconds: 10, maxRetries: 0 });
    },
  });
}
