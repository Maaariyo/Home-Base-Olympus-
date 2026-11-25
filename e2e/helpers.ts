// Shared setup for the browser tests: a static server shaped like Vercel, and a page that records errors.
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join } from "node:path";
import type { Browser, BrowserContextOptions, Page } from "playwright";

const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
  ".txt": "text/plain",
};

// The production security headers from vercel.json, so every test runs under the real Content-Security-Policy.
// Only change: the fake Supabase host the auth tests answer is added to connect-src.
const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as { headers: { source: string; headers: { key: string; value: string }[] }[] };
const HEADERS = Object.fromEntries(
  vercel.headers.find((h) => h.source === "/(.*)")!.headers.map((h) => [h.key, h.value.replace("connect-src 'self'", "connect-src 'self' http://supabase.test")]),
);

/** Serves a static export the way Vercel does: /calendar -> calendar.html, with the production headers. */
export async function serve(root: string) {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    for (const file of [path, `${path}.html`, join(path, "index.html")]) {
      try {
        const body = await readFile(join(root, file));
        res.writeHead(200, { ...HEADERS, "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
        return void res.end(body);
      } catch {
        /* try the next candidate */
      }
    }
    res.writeHead(404).end("not found");
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((ok) => server.close(() => ok())) };
}

/** Polls until `check` returns true (the page re-renders after each save), or fails after 5 s. */
export async function until(check: () => Promise<boolean>, what: string) {
  for (const end = Date.now() + 5000; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) if (await check()) return;
  throw new Error(`Timed out waiting for: ${what}`);
}

/** A phone-sized page in Indian time; `errors` collects console errors and crashes. */
export async function openPage(browser: Browser, options: BrowserContextOptions = {}): Promise<{ page: Page; errors: string[] }> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "Asia/Kolkata", ...options });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  return { page, errors };
}
