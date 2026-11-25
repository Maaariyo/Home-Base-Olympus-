// Browser tests for sign-in, closed sign-ups and password reset, against a build pointed at a fake
// Supabase (http://supabase.test) whose answers are mocked here. Run: npm run test:e2e
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { openPage, serve } from "./helpers.ts";

let browser: Browser;
let site: Awaited<ReturnType<typeof serve>>;

before(async () => {
  site = await serve(new URL("./.out-supabase", import.meta.url).pathname);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  await site?.close();
});

const user = {
  id: "00000000-0000-0000-0000-000000000001",
  aud: "authenticated",
  role: "authenticated",
  email: "me@example.com",
  app_metadata: { provider: "email" },
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};

function accessToken() {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${part({ alg: "HS256", typ: "JWT" })}.${part({ sub: user.id, email: user.email, role: "authenticated", aud: "authenticated", exp, session_id: "s1" })}.${Buffer.alloc(32, 7).toString("base64url")}`; // a well-formed (unverified) signature, as real tokens have
}

const session = () => ({ access_token: accessToken(), token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "refresh", user });

/** Answers Supabase Auth and REST calls; returns the list of calls made. */
async function mockSupabase(page: Page, { signupDisabled = false, recoverError = "" } = {}) {
  const calls: string[] & { offline?: boolean } = [];
  await page.route("http://supabase.test/**", async (route) => {
    if (calls.offline) return route.abort("internetdisconnected");
    const req = route.request();
    const url = new URL(req.url());
    const key = `${req.method()} ${url.pathname}`;
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    calls.push(key);
    const json = (status: number, body: unknown) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });
    if (key === "POST /auth/v1/signup") {
      return signupDisabled ? json(422, { code: 422, error_code: "signup_disabled", msg: "Signups not allowed for this instance" }) : json(200, session());
    }
    if (key === "POST /auth/v1/recover") return recoverError ? json(400, { code: 400, msg: recoverError }) : json(200, {});
    if (key === "POST /auth/v1/token") return json(200, session());
    if (key === "GET /auth/v1/user" || key === "PUT /auth/v1/user") return json(200, user);
    if (key === "POST /auth/v1/logout") return route.fulfill({ status: 204, headers: cors });
    if (key === "POST /rest/v1/calendar_feeds") return json(201, { token: "11111111-2222-4333-8444-555555555555" });
    if (url.pathname.startsWith("/rest/v1/")) return json(200, []);
    return json(404, { msg: `not mocked: ${key}` });
  });
  return calls;
}

async function open(hash = "", options: { signupDisabled?: boolean; recoverError?: string } = {}) {
  const { page, errors } = await openPage(browser);
  const calls = await mockSupabase(page, options);
  await page.goto(`${site.url}/${hash}`);
  await page.waitForSelector("h1");
  return { page, errors, calls };
}

test("signing in reaches the planner", async () => {
  const { page, errors, calls } = await open();
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill("secret123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Today" }).waitFor();
  assert.ok(calls.includes("POST /auth/v1/token"));
  assert.deepEqual(errors, []);
  await page.context().close();
});

test("closed sign-ups get a plain explanation", async () => {
  const { page } = await open("", { signupDisabled: true });
  await page.getByRole("button", { name: /Create an account/ }).click();
  await page.getByLabel("Email").fill("someone@example.com");
  await page.getByLabel("Password").fill("secret123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByText("New sign-ups are closed on this site.").waitFor();
  await page.context().close();
});

test("forgot password asks Supabase to send a reset link", async () => {
  const { page, calls } = await open();
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await page.getByLabel("Email").fill(user.email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await page.getByText(/a reset link is on its way/).waitFor();
  assert.ok(calls.includes("POST /auth/v1/recover"));
  await page.context().close();
});

test("a reset link asks for a new password, then opens the planner", async () => {
  const params = new URLSearchParams({ access_token: accessToken(), expires_in: "3600", refresh_token: "refresh", token_type: "bearer", type: "recovery" });
  const { page, calls, errors } = await open(`#${params}`);
  await page.getByRole("heading", { name: "Set a new password" }).waitFor();
  await page.getByLabel(/^New password/).fill("new-secret-1");
  await page.getByLabel("Repeat new password").fill("new-secret-2");
  await page.getByText("The passwords don't match.").waitFor();
  await page.getByLabel("Repeat new password").fill("new-secret-1");
  await page.getByRole("button", { name: "Save password" }).click();
  await page.getByRole("heading", { name: "Today" }).waitFor();
  assert.ok(calls.includes("PUT /auth/v1/user"));
  assert.deepEqual(errors, []);
  await page.context().close();
});

test("an expired email link says so", async () => {
  const { page } = await open("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
  await page.getByText("That email link has expired or was already used. Request a new one.").waitFor();
  await page.context().close();
});

async function signIn(page: Page) {
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill("secret123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Today" }).waitFor();
}

test("offline after signing in: the last copy shows with a banner, and a save explains why it failed", async () => {
  const { page, calls } = await open();
  await signIn(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  calls.offline = true;
  await page.context().setOffline(true);
  await page.reload();
  await page.getByText(/^Offline: showing your copy from/).waitFor();
  await page.goto(`${site.url}/tasks`);
  await page.getByLabel("New task").click();
  await page.getByPlaceholder("What needs doing?").fill("Written offline");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByText("You're offline. This change wasn't saved; try again when you're connected.").waitFor();
  await page.context().close();
});

test("calendar feed: Settings creates a private link with Google and iPhone instructions", async () => {
  const { page, calls } = await open();
  await signIn(page);
  await page.goto(`${site.url}/settings`);
  await page.getByRole("button", { name: "Get my calendar link" }).click();
  const link = page.getByLabel("Calendar link");
  assert.equal(await link.inputValue(), "http://supabase.test/functions/v1/calendar?token=11111111-2222-4333-8444-555555555555");
  assert.ok(calls.includes("POST /rest/v1/calendar_feeds"));
  await page.getByText("Treat this link like a password").waitFor();
  await page.context().close();
});

test("signing out removes the offline copy from the device", async () => {
  const { page } = await open();
  await signIn(page);
  await page.waitForFunction(() => Object.keys(localStorage).some((k) => k.startsWith("home-base-cache:")));
  await page.goto(`${site.url}/settings`);
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("button", { name: "Sign in" }).waitFor();
  assert.equal(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("home-base-cache:")).length), 0);
  await page.context().close();
});

test("a crafted link carrying someone's session (not a reset link) does not sign you in", async () => {
  const params = new URLSearchParams({ access_token: accessToken(), refresh_token: "refresh", token_type: "bearer", expires_in: "3600" });
  const { page, calls } = await open(`#${params}`);
  await page.getByRole("button", { name: "Sign in" }).waitFor();
  assert.ok(!calls.includes("GET /auth/v1/user"), "the tokens in the link were never used");
  assert.equal(new URL(page.url()).hash, "", "the tokens are removed from the address bar");
  await page.context().close();
});

test("text from a link is never shown on the page", async () => {
  const { page } = await open("#error=access_denied&error_description=Call+our+support+on+evil.example");
  await page.getByText("That link didn't work. Request a new one.").waitFor();
  assert.equal(await page.getByText(/evil\.example/).count(), 0);
  await page.context().close();
});

test("a reset request gives the same answer whether or not the account exists", async () => {
  const { page } = await open("", { recoverError: "Email address not authorized" });
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await page.getByLabel("Email").fill("member@example.com");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await page.getByText(/If an account exists for that email, a reset link is on its way/).waitFor();
  assert.equal(await page.getByText(/not authori/i).count(), 0);
  await page.context().close();
});

test("the signed-in account is shown, so a wrong account is noticed", async () => {
  const { page } = await openPage(browser, { viewport: { width: 1280, height: 800 } });
  await mockSupabase(page);
  await page.goto(`${site.url}/`);
  await signIn(page);
  await page.getByText("Signed in as").waitFor();
  await page.getByText(user.email).first().waitFor();
  await page.context().close();
});
