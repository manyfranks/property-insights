import puppeteer, { Browser } from "puppeteer-core";

export async function getBrowser(): Promise<Browser> {
  const browserlessKey = process.env.BROWSERLESS_API_KEY;

  if (browserlessKey) {
    return puppeteer.connect({
      browserWSEndpoint: `wss://chrome.browserless.io?token=${browserlessKey}`,
    });
  }

  // Local development: connect to a local Chrome/Chromium
  // Tries common paths on macOS, Linux, Windows
  const localPaths = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ];

  for (const executablePath of localPaths) {
    try {
      return await puppeteer.launch({
        executablePath,
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
    } catch {
      continue;
    }
  }

  throw new Error(
    "No browser available. Set BROWSERLESS_API_KEY for cloud browser, or install Chrome locally."
  );
}
