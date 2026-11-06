export function describeRegistrationPlatform(userAgent = "", desktopIpad = false) {
  if (/iPhone|iPod/i.test(userAgent)) return { platform: "IPHONE", name: "iPhone" };
  if (/iPad/i.test(userAgent) || (desktopIpad && /Macintosh/i.test(userAgent))) return { platform: "IPAD", name: "iPad" };
  if (/Android/i.test(userAgent)) return { platform: "ANDROID", name: "Android" };
  if (/Windows/i.test(userAgent)) return { platform: "WINDOWS", name: "Windows" };
  if (/Macintosh|Mac OS X/i.test(userAgent)) return { platform: "MAC", name: "Mac" };
  if (/CrOS/i.test(userAgent)) return { platform: "CHROMEOS", name: "ChromeOS" };
  if (/Linux/i.test(userAgent)) return { platform: "LINUX", name: "Linux" };
  return { platform: "OTHER", name: "Khidi" };
}
