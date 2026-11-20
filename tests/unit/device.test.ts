import { expect, test } from "bun:test";
import { linkRoute, onPhoneOrTablet, viewport } from "../../src/lib/device";

const UA = {
  // An iPad's too: it asks for sites as a Mac would.
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)",
  android: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0",
  linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)",
};

test("phones and tablets, and computers, a touch screen or not", () => {
  expect([onPhoneOrTablet(UA.mac, 5), onPhoneOrTablet(UA.iphone, 5), onPhoneOrTablet(UA.android, 5)]).toEqual([true, true, true]);
  expect([onPhoneOrTablet(UA.mac, 0), onPhoneOrTablet(UA.windows, 0), onPhoneOrTablet(UA.linux, 0)]).toEqual([false, false, false]);
  // A Surface, or any laptop with a touch screen.
  expect([onPhoneOrTablet(UA.windows, 10), onPhoneOrTablet(UA.linux, 10)]).toEqual([false, false]);
});

test("the apps never zoom; Safari on iPhone and iPad still pinches, but doesn't zoom into fields; other browsers keep it all", () => {
  const base = "width=device-width, initial-scale=1";
  expect(viewport(base, { app: true, ios: true })).toBe(`${base}, maximum-scale=1, user-scalable=no`);
  expect(viewport(base, { app: true, ios: false })).toBe(`${base}, maximum-scale=1, user-scalable=no`);
  expect(viewport(base, { app: false, ios: true })).toBe(`${base}, maximum-scale=1`);
  expect(viewport(base, { app: false, ios: false })).toBe(base);
});

test("in the phone apps a web page opens over lines, unless Settings or the link's menu says the browser; elsewhere in the browser", () => {
  const page = "https://example.com/a?b=c";
  const phone = { phoneApp: true, openLinks: "lines" } as const;
  expect(linkRoute(page, phone)).toBe("lines");
  expect(linkRoute("HTTP://example.com", phone)).toBe("lines");
  expect(linkRoute(page, { ...phone, openLinks: "browser" })).toBe("browser");
  // Open in Browser, and signing in to a site, where people are signed in already.
  expect(linkRoute(page, { ...phone, inBrowser: true })).toBe("browser");
  // The desktop apps and the web have no view of their own: the setting isn't theirs.
  expect(linkRoute(page, { phoneApp: false, openLinks: "lines" })).toBe("browser");
  expect(linkRoute(page, { phoneApp: false, openLinks: "browser" })).toBe("browser");
});

test("mail and phone numbers go to their apps, however links open; anything else nowhere", () => {
  for (const settings of [
    { phoneApp: true, openLinks: "lines" },
    { phoneApp: true, openLinks: "browser" },
    { phoneApp: false, openLinks: "lines" },
  ] as const) {
    expect(linkRoute("mailto:someone@example.com", settings)).toBe("system");
    expect(linkRoute("tel:+15551234567", settings)).toBe("system");
    for (const unsafe of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,hi", "lines://note", "https://", "example.com", ""]) {
      expect(linkRoute(unsafe, settings)).toBeNull();
    }
  }
});
