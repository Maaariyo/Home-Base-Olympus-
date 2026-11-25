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

test("grades: the subject panel shows what's needed, and updates when a score is entered", async () => {
  const { page } = await open("/attendance");
  await page.getByRole("button", { name: /Marketing Management/ }).click();
  await page.getByText("You need 70.7% on average across the remaining 75% to finish at 70%.").waitFor();
  const project = page.getByLabel("Score for Group project, out of 100");
  await project.fill("80");
  await project.press("Enter");
  await page.getByText("You need 66% on average across the remaining 50% to finish at 70%.").waitFor();
  // Add a component; the weights now add up to more than 100, which is called out.
  await page.getByRole("button", { name: "Add a graded component" }).click();
  await page.getByLabel("Component name").fill("Quiz 2");
  await page.getByLabel("Weight, percent of the final mark").fill("10");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByText("Weights add up to 110%, not 100%.").waitFor();
  await page.context().close();
});

test("timetable import: pasted spreadsheet cells add classes and new subjects, duplicates are skipped", async () => {
  const { page } = await open("/timetable");
  const paste = "Day\tStart\tEnd\tSubject\tCode\tRoom\tType\nThu\t4:00 pm\t5:15 pm\tBusiness Ethics\tBE\tLT 4\tLecture\nSat\t09:00\t11:30\tBusiness Ethics\tBE\tLab 1\tLab\nFunday\t09:00\t10:00\tX\t\t\t\n";
  await page.getByRole("button", { name: "Import timetable" }).click();
  await page.getByLabel("Timetable rows").fill(paste);
  await page.getByText("Row 4: “Funday” is not a day.").waitFor();
  await page.getByText("New subjects: Business Ethics.", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Add 2 classes" }).click();
  await page.getByText("Added 2 classes").waitFor();
  assert.ok((await page.getByText("BE", { exact: true }).count()) >= 2, "both classes on the grid");
  // The same rows again add nothing.
  await page.getByRole("button", { name: "Import timetable" }).click();
  await page.getByLabel("Timetable rows").fill(paste);
  await page.getByRole("button", { name: "Add 2 classes" }).click();
  await page.getByText("Added 0 classes; 2 already in your timetable").waitFor();
  await page.context().close();
});

test("offline: after one visit the site opens with no connection", async () => {
  const { page, errors } = await open("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.context().setOffline(true);
  await page.goto(site.url + "/calendar");
  await page.getByRole("heading", { name: "Calendar" }).waitFor();
  await page.goto(site.url + "/attendance");
  await page.getByRole("heading", { name: "Attendance" }).waitFor();
  assert.deepEqual(errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e)), []);
  await page.context().close();
});

test("settings: the calendar feed explains it needs Supabase in demo mode; weekly digest is on", async () => {
  const { page } = await open("/settings");
  await page.getByText("Available once the site is connected to Supabase.").first().waitFor();
  assert.equal(await page.getByLabel(/^Weekly digest/).isChecked(), true);
  await page.context().close();
});

test("keyboard: an editor takes focus, keeps it while typing, Tab stays inside, Escape returns focus", async () => {
  const { page } = await open("/tasks");
  const fab = page.getByLabel("New task");
  await fab.focus();
  await page.keyboard.press("Enter");
  const heading = page.getByPlaceholder("What needs doing?");
  await heading.waitFor();
  assert.ok(await heading.evaluate((el) => el === document.activeElement), "focus moves into the editor");
  await page.keyboard.type("Typed without losing focus");
  assert.equal(await heading.inputValue(), "Typed without losing focus");
  for (let i = 0; i < 40; i++) await page.keyboard.press("Tab");
  assert.ok(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')), "Tab stays inside the editor");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  assert.ok(await fab.evaluate((el) => el === document.activeElement), "focus returns to the + button");
  await page.context().close();
});
