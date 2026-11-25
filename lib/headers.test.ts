// The two hosting configs must send the same security headers.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("vercel.json and public/_headers send the same security headers", () => {
  const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  const fromVercel = vercel.headers.flatMap((h: { source: string; headers: { key: string; value: string }[] }) => h.headers.map((x) => `${h.source === "/(.*)" ? "/*" : h.source} ${x.key}: ${x.value}`));
  const fromFile: string[] = [];
  let path = "";
  for (const line of readFileSync(new URL("../public/_headers", import.meta.url), "utf8").split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    if (!line.startsWith(" ")) path = line.trim();
    else fromFile.push(`${path} ${line.trim()}`);
  }
  assert.deepEqual(fromFile.sort(), fromVercel.sort());
  const csp = fromVercel.find((h: string) => h.includes("Content-Security-Policy"))!;
  for (const rule of ["frame-ancestors 'none'", "object-src 'none'", "connect-src 'self' https://*.supabase.co", "base-uri 'self'"]) assert.ok(csp.includes(rule), rule);
});
