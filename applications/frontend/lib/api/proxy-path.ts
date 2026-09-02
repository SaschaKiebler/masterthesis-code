/**
 * Joins the segments of a catch-all route into an upstream path.
 *
 * Next.js splits the catch-all on literal slashes and decodes each segment
 * afterwards, so a segment may still contain "/" (from %2F) or be "..". Passed
 * through untouched, fetch() normalises the dot segments away and the request
 * leaves the prefix the proxy is meant to pin it to: /api/v1/..%2F..%2Factuator
 * reaches core's /actuator, which sits outside the authenticated matcher.
 * Found by the QS-SEC-01 review of 2026-09-02.
 *
 * Returns null when a segment would change the path structure; every proxy
 * answers 400 in that case. Otherwise each segment is re-encoded, so it can
 * only ever be one segment upstream as well.
 */
export function joinProxyPath(segments: string[]): string | null {
  for (const segment of segments) {
    if (
      segment === "" ||
      segment === "." ||
      segment === ".." ||
      segment.includes("/") ||
      segment.includes("\\")
    ) {
      return null;
    }
  }
  return segments.map(encodeURIComponent).join("/");
}

/** One path parameter interpolated into an upstream path, same rules as above. */
export function pathSegment(value: string): string | null {
  return joinProxyPath([value]);
}
