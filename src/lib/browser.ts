import puppeteer, { Browser } from "puppeteer-core";

const CONNECT_TIMEOUT_MS = 10_000;

export async function getBrowser(): Promise<Browser> {
  const browserlessKey = process.env.BROWSERLESS_API_KEY;

  if (browserlessKey) {
    // Race the websocket connection against a hard timeout —
    // Browserless can hang indefinitely if the service is down.
    const connected = puppeteer.connect({
      browserWSEndpoint: `wss://chrome.browserless.io?token=${browserlessKey}`,
      protocolTimeout: 15_000,
    });

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Browserless connection timed out")), CONNECT_TIMEOUT_MS)
    );

    return Promise.race([connected, timeout]);
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
