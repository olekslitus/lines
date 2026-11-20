import { expect, test } from "bun:test";
import { downloadName } from "../../scripts/release.mjs";

test("downloads are named by the system they're for, their signatures too", () => {
  const named = (file: string) => downloadName(file, "0.3.3");
  expect(
    [
      "Lines_0.3.3_universal.dmg",
      "Lines.app.tar.gz",
      "Lines.app.tar.gz.sig",
      "Lines_0.3.3_x64-setup.exe",
      "Lines_0.3.3_x64_en-US.msi.sig",
      "Lines_0.3.3_amd64.AppImage",
      "Lines_0.3.3_amd64.deb",
      "Lines-0.3.3-1.x86_64.rpm",
      "app-universal-release.apk",
      "app-universal-release.aab",
    ].map(named),
  ).toEqual([
    "lines_0.3.3_macos_universal.dmg",
    "lines_0.3.3_macos_universal.app.tar.gz",
    "lines_0.3.3_macos_universal.app.tar.gz.sig",
    "lines_0.3.3_windows_x64-setup.exe",
    "lines_0.3.3_windows_x64.msi.sig",
    "lines_0.3.3_linux_amd64.AppImage",
    "lines_0.3.3_linux_amd64.deb",
    "lines_0.3.3_linux_x86_64.rpm",
    "lines_0.3.3_android_universal.apk",
    "lines_0.3.3_android_universal.aab",
  ]);
  // An unsigned Android build is left as it is, so it isn't attached to a release.
  expect(named("app-universal-release-unsigned.apk")).toBe("app-universal-release-unsigned.apk");
  // Named once, and nothing else is.
  expect(named("lines_0.3.3_macos_universal.dmg")).toBe("lines_0.3.3_macos_universal.dmg");
  expect([named("Lines.app"), named("latest.json")]).toEqual(["Lines.app", "latest.json"]);
});
