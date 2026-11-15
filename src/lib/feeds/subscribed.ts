import { propertyOf } from "../notes/properties";

/** A note's feed, if it's a subscription: its `feed:` property, a link to the web. */
export function feedOf(properties: Parameters<typeof propertyOf>[0]): string | null {
  const value = propertyOf(properties, "feed")?.value.trim();
  return value && /^https?:\/\/\S+$/i.test(value) ? value : null;
}
