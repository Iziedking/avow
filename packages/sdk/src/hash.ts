// Hashing and canonical encoding for evidence bundles.
//
// The hash has to be reproducible by anyone, so the bundle is encoded as JSON with object
// keys sorted. Two parties encoding the same bundle get the same bytes and the same hash.
// SHA-256 runs through Web Crypto, which is present in Node 20 and up and in the browser.

export function encodeBundle(bundle: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalJson(bundle));
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  // Copy into a freshly allocated ArrayBuffer so the bytes satisfy BufferSource regardless
  // of how the caller's view was backed.
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(data));
  return new Uint8Array(digest);
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === "object") {
    const input = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
      sorted[key] = sortKeys(input[key]);
    }
    return sorted;
  }
  return value;
}
