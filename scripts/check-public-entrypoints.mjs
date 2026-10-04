import { pathToFileURL } from "node:url";

export const publicEntrypoints = [
  "https://jconthemove.com/",
  "https://www.jconthemove.com/",
  "https://jconthemove.com/book",
  "https://www.jconthemove.com/book",
  "https://jconthemove.com/book?utm_source=availability-check&rep=matt",
];

export async function checkPublicEntrypoints({
  urls = publicEntrypoints,
  fetchImpl = fetch,
  timeoutMs = 15000,
} = {}) {
  // Probe every entry independently: a healthy www host must not hide an apex outage.
  return Promise.all(urls.map(async (url) => {
    try {
      const response = await fetchImpl(url, {
        redirect: "follow",
        headers: { "Cache-Control": "no-store" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const destination = new URL(response.url);
      if (destination.protocol !== "https:" ||
          !["jconthemove.com", "www.jconthemove.com"].includes(destination.hostname)) {
        throw new Error("redirect left the HTTPS production website");
      }
      if (destination.pathname !== new URL(url).pathname) {
        throw new Error("redirect did not preserve the requested page");
      }
      if (destination.search !== new URL(url).search) {
        throw new Error("redirect did not preserve the requested query");
      }
      const html = await response.text();
      if (!response.headers.get("content-type")?.includes("text/html") ||
          !/<title>[^<]*JC ON THE MOVE/i.test(html) ||
          !/id=["']root["']/.test(html) || !/<script\b[^>]*\bsrc=/i.test(html)) {
        throw new Error("response is not the JC customer application HTML");
      }
      return { url, ok: true, destination: response.url };
    } catch (error) {
      return { url, ok: false, error: error instanceof Error ? error.message : "request failed" };
    }
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await checkPublicEntrypoints();
  for (const result of results) {
    console.log(`[public-entrypoint] ${result.ok ? "PASS" : "FAIL"} ${result.url} ${result.ok ? result.destination : result.error}`);
  }
  if (results.some((result) => !result.ok)) process.exitCode = 1;
}
