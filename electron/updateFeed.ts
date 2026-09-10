export const RELEASES_BASE_URL = 'https://github.com/pablocastilla/prompt-pad/releases';
export const RELEASES_FEED_URL = `${RELEASES_BASE_URL}.atom`;

const TAG_HREF_PATTERN = /\/releases\/tag\/([^"'\s<]+)/g;

export function getTagsFromFeed(xml: string): string[] {
  const tags = new Set<string>();
  for (const match of xml.matchAll(TAG_HREF_PATTERN)) {
    tags.add(match[1]);
  }
  return [...tags];
}

export function parseVersionTag(tag: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

export function pickNewestStableTag(tags: string[]): string | null {
  let newest: string | null = null;
  let newestVersion: [number, number, number] | null = null;
  for (const tag of tags) {
    const version = parseVersionTag(tag);
    if (!version) continue;
    if (!newestVersion || compareVersions(version, newestVersion) > 0) {
      newest = tag;
      newestVersion = version;
    }
  }
  return newest;
}

export async function resolveNewestStableTag(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const response = await fetchImpl(RELEASES_FEED_URL, {
      headers: { accept: 'application/atom+xml, application/xml, text/xml, */*' },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const xml = await response.text();
    return pickNewestStableTag(getTagsFromFeed(xml));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Could not resolve newest release from GitHub feed: ${message}`);
    return null;
  }
}
