// Browser tests against the demo build (sample term, data in localStorage). Run: npm run test:e2e
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { openPage, serve, until } from "./helpers.ts";

let browser: Browser;
let site: Awaited<ReturnType<typeof serve>>;

before(async () => {
  site = await serve(new URL("./.out-demo", import.meta.url).pathname);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  await site?.close();
});

async function open(path: string, colorScheme: "light" | "dark" = "light") {
  const { page, errors } = await openPage(browser, { colorScheme });
  await page.goto(site.url + path);
  await page.waitForSelector("h1");
  return { page, errors };
}

const pct = async (page: Page, subject: string) => parseFloat(await page.locator(`[data-subject="${subject}"] b`).innerText());

test("every page renders without errors, in light and dark mode", async () => {
  for (const scheme of ["light", "dark"] as const) {
    for (const path of ["/", "/tasks", "/calendar", "/attendance", "/timetable", "/settings", "/plan"]) {
      const { page, errors } = await open(path, scheme);
      await page.waitForTimeout(200);
      assert.deepEqual(errors, [], `${scheme} ${path}`);
      if (scheme === "dark" && path === "/") {
        assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), "rgb(19, 21, 24)");
      }
      await page.context().close();
    }
  }
});

test("add a task, delete it, and Undo brings it back", async () => {
  const { page } = await open("/tasks");
  await page.getByLabel("New task").click();
  await page.getByPlaceholder("What needs doing?").fill("Read Porter's five forces chapter");
  await page.getByPlaceholder("Type a name, press Enter").fill("Aditi");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: /Upcoming/ }).click();
  const row = page.getByRole("button", { name: /^Read Porter/ });
  await row.waitFor();
  await row.click();
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Undo" }).click();
  await row.waitFor();
  await page.context().close();
});

test("marking a class removes it from Not marked yet", async () => {
  const { page } = await open("/attendance");
  const present = page.locator("#unmarked").getByRole("button", { name: "Present" });
  const before = await present.count();
  assert.ok(before > 0, "demo data leaves classes unmarked");
  await present.first().click();
  await until(async () => (await present.count()) === before - 1, "one fewer unmarked class");
  await page.context().close();
});

test("a new timetable class appears on the grid", async () => {
  const { page } = await open("/timetable");
  await page.getByLabel("Add class on Sat").click();
  await page.locator('input[type="time"]').first().fill("15:00");
  await page.locator('input[type="time"]').nth(1).fill("16:15");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Timetable saved").waitFor();
  assert.ok((await page.getByText(/3:00\s?pm–4:15\s?pm/i).count()) > 0);
  await page.context().close();
});

test("settings survive a reload", async () => {
  const { page } = await open("/settings");
  await page.getByLabel("Target %").fill("80");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Settings saved").waitFor();
  await page.reload();
  await page.waitForSelector("h1");
  assert.equal(await page.getByLabel("Target %").inputValue(), "80");
  await page.context().close();
});

test("one date of a repeating event can be skipped", async () => {
  const { page } = await open("/calendar");
  await page.getByRole("button", { name: "week", exact: true }).click();
  const meet = page.getByRole("button", { name: /Finance club meet/ });
  const before = await meet.count();
  await meet.first().click();
  await page.getByRole("button", { name: "Skip this date" }).click();
  await page.getByText(/^Skipped/).waitFor();
  await until(async () => (await meet.count()) === before - 1, "one fewer club meeting this week");
  await page.context().close();
});

test("links in task notes are clickable", async () => {
  const { page } = await open("/tasks");
  await page.getByLabel("New task").click();
  await page.locator("textarea").fill("Deck: https://docs.google.com/presentation/d/abc and notes");
  assert.equal(await page.getByRole("link", { name: /docs\.google\.com/ }).getAttribute("href"), "https://docs.google.com/presentation/d/abc");
  await page.context().close();
});

test("what-if: skipping a class lowers that subject's projection, unticking restores it", async () => {
  const { page } = await open("/plan");
  const summary = page.getByTestId("plan-summary");
  assert.match(await summary.innerText(), /^Attending all \d+ classes/);
  const box = page.getByLabel(/^Skip .+ on /).first();
  const subject = (await box.getAttribute("aria-label"))!.replace(/^Skip (.+) on .*$/, "$1");
  const before = await pct(page, subject);
  await box.check();
  assert.match(await summary.innerText(), /^Skipping 1 class/);
  assert.ok((await pct(page, subject)) < before, `${subject} should drop below ${before}`);
  await box.uncheck();
  assert.equal(await pct(page, subject), before);
  // A subject below target even with full attendance is not blamed on the skip.
  const below = page.getByTestId("plan-below-anyway");
  if (await below.count()) {
    const name = (await below.innerText()).split(/ stays? below/)[0].split(", ")[0];
    const theirs = page.getByLabel(new RegExp(`^Skip ${name} on `)).first();
    await theirs.check();
    assert.doesNotMatch(await summary.innerText(), new RegExp(name));
    await theirs.uncheck();
  }
  // A whole day at once
  await page.getByLabel("Skip whole day").first().check();
  assert.match(await summary.innerText(), /^Skipping \d+ class/);
  await page.context().close();
});
