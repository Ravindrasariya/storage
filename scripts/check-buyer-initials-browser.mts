// Actual Buyer Ledger UI with every API request intercepted; no database traffic.
import assert from "node:assert/strict";
import { chromium } from "playwright";

assert.match(process.env.REPLIT_DEV_DOMAIN ?? "", /^[a-z0-9.-]+\.replit\.dev$/i);
const base = `https://${process.env.REPLIT_DEV_DOMAIN}`;
const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => {
    (window as any).__name = (fn: unknown) => fn;
    localStorage.setItem("cold_store_auth_token", "mock-buyer-test-only");
    if (!localStorage.getItem("language")) localStorage.setItem("language", "en");
  });
  const buyer = (id: string, buyerName: string, initials: string | null) => ({
    id, buyerId: `BY20261025${id}`, buyerName, initials, address: "", contactNumber: "",
    coldStorageId: "mock", isArchived: 0, isFlagged: 0, createdAt: "2026-10-25T12:00:00+05:30",
    pyReceivables: 0, advanceDue: 0, dueTransferOut: 0, dueTransferIn: 0, salesDue: 0, buyerExtras: 0, netDue: 0,
  });
   const buyers = [buyer("1", "Roop Laxmi Traders", "rLt"), buyer("2", "Legacy Buyer", "LegacyLong")];
  const writes: { path: string; data: any }[] = [];
  await context.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== "GET") {
      const data = request.postDataJSON();
      writes.push({ path, data });
      if (path.endsWith("/check-merge")) return route.fulfill({ json: { willMerge: false } });
      if (path === "/api/buyer-ledger/manual") {
        buyers.push({ ...buyer("3", data.buyerName, data.initials || null), ...data });
        return route.fulfill({ status: 201, json: { id: "3", buyerId: "BY202610253" } });
      }
      assert.match(path, /^\/api\/buyer-ledger\/[123]$/, `Unexpected mutation ${path}`);
      assert.equal(request.method(), "PATCH");
      const record = buyers.find(b => path.endsWith(`/${b.id}`))!;
      Object.assign(record, data, { initials: data.initials?.trim() || null });
      return route.fulfill({ json: { buyer: record, merged: false } });
    }
    if (path === "/api/auth/session") return route.fulfill({ json: {
      user: { id: "mock-user", name: "Test Operator", mobileNumber: "0000000000", accessType: "edit", coldStorageId: "mock" },
      coldStorage: { id: "mock", name: "Buyer initials test", totalCapacity: 100, waferRate: 60, seedRate: 60 },
    } });
    if (path === "/api/buyer-ledger") return route.fulfill({ json: { buyers, summary: {} } });
    return route.fulfill({ json: [] });
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const field = (id: string) => page.getByTestId(id);
  async function openEdit(id: string) {
    if (page.viewportSize()!.width >= 768) await field(`button-edit-${id}`).click();
    else await field(`card-buyer-${id}`).getByRole("button").first().click();
    await field("input-edit-buyer-initials").waitFor();
  }
  async function layout(nameId: string, initialsId: string) {
    // Wait for dialog opening/centering animations after viewport changes.
    await page.waitForTimeout(250);
    const name = await field(nameId).boundingBox();
    const initials = await field(initialsId).boundingBox();
    const dialog = await page.getByRole("dialog").boundingBox();
    assert.ok(name && initials && dialog);
    assert.ok(Math.abs(name.y - initials.y) < 1, `Name and initials must share a row: ${JSON.stringify({ name, initials })}`);
    assert.ok(initials.x > name.x + name.width, "Initials must be to the right");
    assert.ok(name.width / initials.width >= 2.8, "Name should have most of the row");
    assert.ok(initials.x + initials.width <= dialog.x + dialog.width);
    assert.ok(dialog.x >= 0 && dialog.x + dialog.width <= page.viewportSize()!.width);
  }
  await page.goto(`${base}/buyer-ledger`, { waitUntil: "networkidle" });
  await field("button-add-buyer").click();
  assert.equal(await field("input-new-buyer-initials").inputValue(), "");
   assert.equal(await field("input-new-buyer-initials").getAttribute("placeholder"), null);
  assert.equal(await field("button-save-add-buyer").isDisabled(), true);
  await field("input-new-buyer-name").fill("Another Buyer");
   await field("input-new-buyer-initials").pressSequentially("abcde");
   assert.equal(await field("input-new-buyer-initials").inputValue(), "ABCDE");
   assert.equal(await field("button-save-add-buyer").isDisabled(), true);
   assert.equal(await field("input-new-buyer-initials").getAttribute("aria-invalid"), "true");
   assert.match(await page.locator("#new-buyer-initials-error").innerText(), /at most 4/);
   assert.equal(writes.length, 0);
   // insertText exercises the same input path as pasted text, without clipboard permissions.
   await field("input-new-buyer-initials").fill("");
   await page.keyboard.insertText("  aBcD  ");
   assert.equal(await field("input-new-buyer-initials").inputValue(), "  ABCD  ");
   assert.equal(await field("button-save-add-buyer").isEnabled(), true);
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await layout("input-new-buyer-name", "input-new-buyer-initials");
    await page.screenshot({ path: `/tmp/buyer-initials-add-${width}.png` });
  }
  await field("button-save-add-buyer").click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
   assert.equal(writes.find(w => w.path === "/api/buyer-ledger/manual")!.data.initials, "ABCD");
  await field("button-add-buyer").click();
  assert.equal(await field("input-new-buyer-initials").inputValue(), "");
  await field("input-new-buyer-initials").fill("abandoned");
  await field("button-cancel-add-buyer").click();
  await field("button-add-buyer").click();
  assert.equal(await field("input-new-buyer-initials").inputValue(), "");
  await field("input-new-buyer-initials").fill("dismiss");
  await page.keyboard.press("Escape");
  await field("button-add-buyer").click();
  assert.equal(await field("input-new-buyer-initials").inputValue(), "");
  await field("button-cancel-add-buyer").click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await openEdit("1");
  assert.equal(await field("input-edit-buyer-initials").inputValue(), "rLt");
   assert.equal(await field("input-edit-buyer-initials").getAttribute("placeholder"), null);
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await layout("input-edit-buyer-name", "input-edit-buyer-initials");
    await page.screenshot({ path: `/tmp/buyer-initials-edit-${width}.png` });
  }
   await field("input-edit-buyer-initials").fill("ßßa");
   assert.equal(await field("input-edit-buyer-initials").inputValue(), "SSSSA");
   assert.equal(await field("button-save-edit").isDisabled(), true);
   assert.match(await page.locator("#edit-buyer-initials-error").innerText(), /at most 4/);
   await field("input-edit-buyer-initials").fill("");
   await page.keyboard.insertText("chng");
   assert.equal(await field("input-edit-buyer-initials").inputValue(), "CHNG");
  await field("button-save-edit").click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const patch = writes.find(w => w.path === "/api/buyer-ledger/1")!;
   assert.equal(patch.data.initials, "CHNG");
  assert.equal(patch.data.buyerName, "Roop Laxmi Traders");
  await page.reload({ waitUntil: "networkidle" });
  await openEdit("1");
   assert.equal(await field("input-edit-buyer-initials").inputValue(), "CHNG");
  await field("input-edit-buyer-initials").fill("");
  await field("button-save-edit").click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await openEdit("1");
  assert.equal(await field("input-edit-buyer-initials").inputValue(), "");
  await field("input-edit-buyer-initials").fill("unsaved");
  await field("button-cancel-edit").click();
  await openEdit("2");
   assert.equal(await field("input-edit-buyer-initials").inputValue(), "LegacyLong");
   assert.equal(await field("button-save-edit").isDisabled(), true);
   assert.match(await page.locator("#edit-buyer-initials-error").innerText(), /at most 4/);
   await field("button-cancel-edit").click();
   assert.equal(buyers[1].initials, "LegacyLong");
   await openEdit("2");
   await field("input-edit-buyer-initials").fill("lgcy");
   await field("button-save-edit").click();
   await page.getByRole("dialog").waitFor({ state: "hidden" });
   await openEdit("2");
   assert.equal(await field("input-edit-buyer-initials").inputValue(), "LGCY");
   await field("input-edit-buyer-initials").fill("");
   await field("button-save-edit").click();
   await page.getByRole("dialog").waitFor({ state: "hidden" });
   await openEdit("2");
   assert.equal(await field("input-edit-buyer-initials").inputValue(), "");
  await page.keyboard.press("Escape");
  await openEdit("1");
  assert.equal(await field("input-edit-buyer-initials").inputValue(), "");
  await field("button-cancel-edit").click();
  await page.evaluate(() => localStorage.setItem("language", "hi"));
  await page.reload({ waitUntil: "networkidle" });
  await field("button-add-buyer").click();
  assert.equal(await page.getByLabel("संक्षिप्त नाम", { exact: true }).isVisible(), true);
   await field("input-new-buyer-initials").fill("abcde");
   assert.match(await page.locator("#new-buyer-initials-error").innerText(), /अधिकतम 4/);
   await field("input-new-buyer-initials").fill("आर");
  // The Hindi label may wrap; both input controls must still line up.
  await layout("input-new-buyer-name", "input-new-buyer-initials");
  assert.deepEqual(errors, []);
   console.log("Buyer initials browser checks passed: no examples, uppercase typing/paste, four-character validation, case expansion, legacy preservation/correction, actual Add/Edit dialogs, layout at 1280/390/320, payloads, saved reload, clear, reset/cancel/dismiss, Hindi.");
} finally {
  await browser.close();
}
