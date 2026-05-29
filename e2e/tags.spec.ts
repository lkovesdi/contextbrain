import { test, expect, type Page } from "@playwright/test";

const SECRET = process.env.DEV_LOGIN_SECRET;

let createdMeetingId: string | null = null;

async function login(page: Page) {
  // dev-login mints a session via the service key and redirects to the app.
  await page.goto(`/api/dev-login?secret=${SECRET}&next=/meetings`);
  await expect(page.getByText("Meetings").first()).toBeVisible();
}

test.beforeAll(() => {
  expect(
    SECRET,
    "DEV_LOGIN_SECRET missing — check .env.local"
  ).toBeTruthy();
});

test.afterAll(async ({ browser }) => {
  // Clean up the meeting this run created so we don't leave test junk behind.
  if (!createdMeetingId) return;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`/api/dev-login?secret=${SECRET}&next=/`);
  await page.request.delete(`/api/meetings/${createdMeetingId}`);
  await ctx.close();
});

test("tag flows: create with tags, meeting bar, context picker, list cards", async ({
  page,
}) => {
  await login(page);
  await page.screenshot({ path: "e2e/shots/01-dashboard.png", fullPage: true });

  // --- New meeting modal: reference + create tags ---
  await page.getByRole("button", { name: "New meeting" }).click();
  await expect(page.getByText("Start a new meeting")).toBeVisible();
  await page.getByPlaceholder("Untitled meeting").fill("E2E tag verification");

  const tagInput = page.getByPlaceholder("Tag, or key: value…");
  await tagInput.click();
  await tagInput.fill("topic: asset tagging");
  await tagInput.press("Enter"); // smart label
  await tagInput.fill("onboarding");
  await tagInput.press("Enter"); // plain tag

  // Both chips should now be staged in the modal.
  await expect(page.getByText("asset tagging").first()).toBeVisible();
  await expect(page.getByText("onboarding").first()).toBeVisible();
  await page.screenshot({ path: "e2e/shots/02-new-meeting-tags.png", fullPage: true });

  await page.getByRole("button", { name: "Create" }).click();

  // --- Meeting page: tag bar reflects the attached tags ---
  await page.waitForURL(/\/meetings\/[0-9a-f-]+/);
  createdMeetingId = page.url().split("/meetings/")[1]?.split(/[?#]/)[0] ?? null;
  expect(createdMeetingId).toBeTruthy();

  // The tag appears in both the header bar and the Context "Tagged meetings"
  // picker, so expect at least one match rather than a unique one.
  await expect(page.getByText("Tags").first()).toBeVisible();
  await expect(page.getByText("asset tagging").first()).toBeVisible();
  await expect(page.getByText("onboarding").first()).toBeVisible();
  await page.screenshot({ path: "e2e/shots/03-meeting-tag-bar.png", fullPage: true });

  // --- Context panel: "Tagged meetings" + add-tag picker ---
  await expect(page.getByText("Tagged meetings")).toBeVisible();
  await page.getByRole("button", { name: "Add tag" }).first().click();
  await expect(page.getByPlaceholder("Search tags…")).toBeVisible();
  await page.screenshot({ path: "e2e/shots/04-context-tag-picker.png", fullPage: true });

  // --- Dashboard: the new meeting row shows its tags inline ---
  await page.goto("/meetings");
  await expect(page.getByText("E2E tag verification")).toBeVisible();
  await expect(page.getByText("asset tagging").first()).toBeVisible();
  await page.screenshot({ path: "e2e/shots/05-list-inline-tags.png", fullPage: true });
});

test("fuzzy search narrows the meetings list", async ({ page }) => {
  await login(page);

  // A uniquely-titled meeting so the assertion doesn't depend on real data.
  const token = `zzqx${Date.now().toString().slice(-6)}`;
  const title = `${token} search probe`;
  const created = await page.request.post("/api/meetings", {
    data: { title },
  });
  const probeId = (await created.json()).id as string;

  try {
    await page.goto("/meetings");
    const search = page.getByPlaceholder("Search meetings…");
    await search.fill(token);

    // Debounced trigram search should resolve to exactly the probe meeting.
    await expect(page.getByText(title)).toBeVisible();
    await expect(page.getByText("Results · 1")).toBeVisible();
    await page.screenshot({ path: "e2e/shots/06-search-results.png", fullPage: true });

    // Clearing the box restores the browse list.
    await search.fill("");
    await expect(page.getByText(/^Recent ·/)).toBeVisible();
  } finally {
    await page.request.delete(`/api/meetings/${probeId}`);
  }
});

test("keyset pagination returns stable, distinct pages", async ({ page }) => {
  await login(page);

  // limit=1 forces a cursor even with few meetings.
  const p1 = await (await page.request.get("/api/meetings?limit=1")).json();
  expect(p1.items.length).toBeLessThanOrEqual(1);

  if (p1.nextCursor) {
    const p2 = await (
      await page.request.get(
        `/api/meetings?limit=1&cursor=${encodeURIComponent(p1.nextCursor)}`
      )
    ).json();
    expect(p2.items.length).toBeLessThanOrEqual(1);
    // Second page must be a different meeting than the first.
    if (p1.items[0] && p2.items[0]) {
      expect(p2.items[0].id).not.toBe(p1.items[0].id);
    }
  }
});
