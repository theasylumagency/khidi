import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { renderInternalQrSvg } from "@khidi/products/labels";
import { TotpEnrollmentSetup, copyTotpSetupKey } from "./totp-enrollment.tsx";

const otpauthUri = "otpauth://totp/Khidi:fixture%40khidi.example?issuer=Khidi&secret=JBSWY3DPEHPK3PXP&algorithm=SHA1&digits=6&period=30";
const enrollment = { base32Secret: "JBSWY3DPEHPK3PXP", otpauthUri, accountLabel: "Khidi — fixture@khidi.example", qrSvg: renderInternalQrSvg(otpauthUri, 240) };

it("uses the server URI unchanged for same-device opening and the local QR image", () => {
  const html = renderToStaticMarkup(createElement(TotpEnrollmentSetup, { enrollment, onCopy: () => {}, copyNotice: null }));
  expect(html).toContain(`href="${otpauthUri.replaceAll("&", "&amp;")}"`);
  expect(html).toContain(encodeURIComponent(enrollment.qrSvg));
  expect(html).toContain("Khidi — fixture@khidi.example");
  expect(html).toContain("QR კოდის ჩვენება სხვა მოწყობილობისთვის");
  expect(html).toContain("totp-mobile-qr"); expect(html).toContain("totp-desktop-qr");
  expect(html).not.toMatch(/src="https?:/);
});

it("copies only the Base32 key, without the URI, label or QR", async () => {
  const write = vi.fn(async (_text: string) => {});
  await copyTotpSetupKey(enrollment, write);
  expect(write).toHaveBeenCalledExactlyOnceWith(enrollment.base32Secret);
});
