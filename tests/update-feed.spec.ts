import { test, expect } from '@playwright/test';
import {
  getTagsFromFeed,
  parseVersionTag,
  pickNewestStableTag,
  resolveNewestStableTag,
  RELEASES_FEED_URL,
} from '../electron/updateFeed';

const SAMPLE_FEED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Release notes from prompt-pad</title>
  <entry>
    <id>tag:github.com,2008:Repository/123/v2.51.0</id>
    <updated>2026-09-10T13:52:54Z</updated>
    <link rel="alternate" type="text/html" href="https://github.com/pablocastilla/prompt-pad/releases/tag/v2.51.0"/>
    <title>v2.51.0</title>
  </entry>
  <entry>
    <id>tag:github.com,2008:Repository/123/v2.50.0</id>
    <updated>2026-09-10T13:52:06Z</updated>
    <link rel="alternate" type="text/html" href="https://github.com/pablocastilla/prompt-pad/releases/tag/v2.50.0"/>
    <title>v2.50.0</title>
  </entry>
  <entry>
    <id>tag:github.com,2008:Repository/123/v2.49.0</id>
    <updated>2026-07-08T10:08:57Z</updated>
    <link rel="alternate" type="text/html" href="https://github.com/pablocastilla/prompt-pad/releases/tag/v2.49.0"/>
    <title>v2.49.0</title>
  </entry>
</feed>`;

test.describe('update feed resolution', () => {
  test('extracts release tags from the atom feed', () => {
    const tags = getTagsFromFeed(SAMPLE_FEED_XML);
    expect(tags).toContain('v2.51.0');
    expect(tags).toContain('v2.50.0');
    expect(tags).toContain('v2.49.0');
  });

  test('returns empty array for malformed xml', () => {
    expect(getTagsFromFeed('not xml at all')).toEqual([]);
  });

  test('parses stable vX.Y.Z tags and rejects other formats', () => {
    expect(parseVersionTag('v2.51.0')).toEqual([2, 51, 0]);
    expect(parseVersionTag('2.51.0')).toEqual([2, 51, 0]);
    expect(parseVersionTag('v2.51.0-beta.1')).toBeNull();
    expect(parseVersionTag('v2.51')).toBeNull();
    expect(parseVersionTag('main')).toBeNull();
  });

  test('picks the highest stable version regardless of feed order', () => {
    const tags = ['v2.9.0', 'v2.51.0', 'v2.50.0', 'v2.100.0', 'not-a-version'];
    expect(pickNewestStableTag(tags)).toBe('v2.100.0');
  });

  test('ignores prerelease tags when picking the newest', () => {
    expect(pickNewestStableTag(['v2.51.0-beta.1', 'v2.50.0'])).toBe('v2.50.0');
  });

  test('returns null when no stable tag exists', () => {
    expect(pickNewestStableTag([])).toBeNull();
    expect(pickNewestStableTag(['v2.51.0-rc.1'])).toBeNull();
  });

  test('resolves the newest tag from a live-like feed', async () => {
    const fetchStub = (async () => new Response(SAMPLE_FEED_XML, { status: 200 })) as unknown as typeof fetch;
    const tag = await resolveNewestStableTag(fetchStub);
    expect(tag).toBe('v2.51.0');
  });

  test('prefers the highest version over the most recently updated entry', async () => {
    const staleFirstFeed = SAMPLE_FEED_XML.replaceAll('v2.51.0', 'v2.3.0');
    const fetchStub = (async () => new Response(staleFirstFeed, { status: 200 })) as unknown as typeof fetch;
    const tag = await resolveNewestStableTag(fetchStub);
    expect(tag).toBe('v2.50.0');
  });

  test('returns null when the feed request fails', async () => {
    const fetchStub = (async () => new Response('server error', { status: 500 })) as unknown as typeof fetch;
    const tag = await resolveNewestStableTag(fetchStub);
    expect(tag).toBeNull();
  });

  test('returns null when the network is unreachable', async () => {
    const fetchStub = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const tag = await resolveNewestStableTag(fetchStub);
    expect(tag).toBeNull();
  });

  test('feed url points at the prompt-pad releases atom feed', () => {
    expect(RELEASES_FEED_URL).toBe('https://github.com/pablocastilla/prompt-pad/releases.atom');
  });
});
