import { parseCertificate } from "./encoding.ts";
import type { Certificate, Handler, ServeOptions } from "./types.ts";

export const MEDIA_TYPE = "application/httpv+json";
export function methodName(method: string): string {
  const name = method.toUpperCase();
  if (!/^[!#$%&'*+.^_`|~0-9A-Z-]+$/.test(name))
    throw new Error("invalid HTTP method");
  return name;
}
function accepts(value: string | null): boolean {
  return (value ?? "").split(",").some((part) => {
    const [type, ...parameters] = part.trim().toLowerCase().split(";");
    return (
      type === MEDIA_TYPE &&
      !parameters.some((p) => /^\s*q\s*=\s*0(?:\.0*)?\s*$/.test(p))
    );
  });
}

/** Return a Fetch handler usable directly with Bun.serve or any Fetch adapter.
 * Paths match exactly; parameterized routes should use a provider function in
 * an application's router, where parameter scope can be explicitly enforced. */
export function discoveryHandler(options: ServeOptions): Handler {
  const paths = new Map<string, Map<string, ServeOptions["routes"][string]>>();
  for (const [route, source] of Object.entries(options.routes)) {
    const split = route.indexOf(" ");
    if (split < 1) throw new Error(`invalid route: ${route}`);
    const method = methodName(route.slice(0, split));
    const path = route.slice(split + 1);
    if (!path.startsWith("/") || path.includes("#") || path.includes("?"))
      throw new Error(`invalid resource path: ${path}`);
    const methods = paths.get(path) ?? new Map();
    if (methods.has(method)) throw new Error(`duplicate route: ${route}`);
    methods.set(method, source);
    paths.set(path, methods);
  }
  return async (request) => {
    if (request.method !== "OPTIONS" || !accepts(request.headers.get("accept")))
      return options.fetch(request);
    const methods = paths.get(new URL(request.url).pathname);
    const headers = {
      "Content-Type": MEDIA_TYPE,
      "Cache-Control": "no-store",
      Vary: "Accept",
    };
    if (!methods)
      return Response.json(
        { error: "No advertised contract for this resource" },
        { status: 404, headers },
      );
    try {
      const entries = await Promise.all(
        [...methods].map(async ([method, source]) => {
          // Files and providers are reloaded for each advertisement, including upgrades.
          const value =
            typeof source === "string"
              ? await Bun.file(source).json()
              : typeof source === "function"
                ? await source()
                : source;
          return [method, parseCertificate(value)] as const;
        }),
      );
      const certificates: Record<string, Certificate> =
        Object.fromEntries(entries);
      return Response.json({ certificates }, { headers });
    } catch {
      return Response.json(
        { error: "Advertised contract unavailable" },
        { status: 503, headers },
      );
    }
  };
}
