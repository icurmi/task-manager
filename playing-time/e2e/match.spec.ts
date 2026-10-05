import { expect, test } from '@playwright/test';

const shots = process.env.SHOTS_DIR;
const shot = async (page: import('@playwright/test').Page, name: string) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false });
};

test('coach runs a full match from login to report', async ({ page }) => {
  // Fake clock: runFor() fast-forwards real-time minutes; a few real seconds still pass while the test runs.
  await page.clock.install();
  await page.goto('/');
  await shot(page, '01-login');
  await page.getByRole('button', { name: /Mario Borg/ }).click();

  // Coach lands straight on "[Team] — New Match"
  await expect(page.getByRole('heading', { name: 'U14 — New Match' })).toBeVisible();
  await page.getByPlaceholder(/Sliema/).fill('Sliema');
  await page.getByRole('button', { name: 'All' }).click();
  // leave #18 out of the squad
  await page.locator('.checklist label').filter({ hasText: 'Sciberras' }).click();
  await shot(page, '02-select');
  await page.getByRole('button', { name: /Next: line-up \(17\)/ }).click();

  const names = ['Borg', 'Camilleri', 'Vella', 'Farrugia', 'Zammit', 'Galea', 'Micallef', 'Grech', 'Attard', 'Spiteri', 'Azzopardi'];
  for (const n of names) await page.locator('.lineup-row').filter({ hasText: n.toUpperCase() }).click();
  await expect(page.getByText('Starting 11 / 11')).toBeVisible();
  await shot(page, '03-lineup');
  await page.getByRole('button', { name: 'Go to match' }).click();

  await expect(page.getByRole('heading', { name: 'MELITA U14 VS SLIEMA' })).toBeVisible();
  await page.getByRole('button', { name: 'START' }).click();
  await page.clock.runFor(10 * 60_000);
  await expect(page.locator('.clock')).toHaveText(/^10:0\d$/);

  // Sub: tap Azzopardi (off) then Mifsud (on)
  await page.locator('.prow.field').filter({ hasText: 'AZZOPARDI' }).click();
  await page.locator('.prow.bench').filter({ hasText: 'MIFSUD' }).click();
  await expect(page.locator('.prow.field').filter({ hasText: 'MIFSUD' })).toBeVisible();
  await page.clock.runFor(5 * 60_000);
  await shot(page, '04-match-running');

  // Undo a mistaken sub
  await page.locator('.prow.field').filter({ hasText: 'BORG' }).click();
  await page.locator('.prow.bench').filter({ hasText: 'AGIUS' }).click();
  await page.getByRole('button', { name: /Undo sub/ }).click();
  await expect(page.locator('.prow.field').filter({ hasText: 'BORG' })).toBeVisible();

  // Reload mid-match: clock comes back from timestamps
  await page.reload();
  await expect(page.locator('.clock')).toHaveText(/^15:[0-3]\d$/);

  await page.clock.runFor(20 * 60_000);
  await page.getByRole('button', { name: 'PERIOD' }).click();
  const atBreak = await page.locator('.clock').textContent();
  await page.clock.runFor(10 * 60_000); // half-time: clock must not move
  await expect(page.locator('.clock')).toHaveText(atBreak!);
  await shot(page, '05-break');
  await page.getByRole('button', { name: /START/ }).click();
  await page.clock.runFor(35 * 60_000);
  await expect(page.locator('.clock')).toHaveText(/^70:[0-5]\d$/);

  await page.getByRole('button', { name: /END/ }).click();
  await shot(page, '06-end-confirm');
  const hold = page.getByRole('button', { name: 'Hold to end game' });
  const box = (await hold.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.clock.runFor(1500);
  await page.mouse.up();

  await expect(page.getByRole('heading', { name: 'Match summary' })).toBeVisible();
  const row = (n: string) => page.locator('table.summary tr').filter({ hasText: n });
  await expect(row('Azzopardi')).toContainText('10');
  await expect(row('Mifsud')).toContainText('60');
  await expect(row('Borg')).toContainText('100%');
  await shot(page, '07-summary');

  // Correction with audit log
  await row('Mifsud').click();
  await page.getByRole('button', { name: 'Edit' }).click();
  const inputs = page.locator('.iv-row input');
  await inputs.nth(0).fill('12:00');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(row('Mifsud')).toContainText('58');
  await expect(page.locator('.audit')).toContainText(/changed Mifsud 10:0\d–70:\d\d → 12:00–70:\d\d/);
  await shot(page, '08-correction');

  // Report export
  await page.goto('/#/reports');
  await expect(page.locator('table.report')).toContainText('Isaac Mifsud');
  await shot(page, '09-report');
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export Excel/ }).click();
  const file = await dl;
  expect(file.suggestedFilename()).toMatch(/\.xlsx$/);
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(await file.path());
  const ws = wb.getWorksheet('Playing time')!;
  expect(ws.getRow(3).values).toEqual([undefined, 'Player', 'Team', 'Called Up', 'Starts', 'Appearances', 'Minutes', 'Available Minutes', '% Played']);
  const mifsud = ws.getRows(4, ws.rowCount - 3)!.find((r) => r.getCell(1).value === 'Isaac Mifsud')!;
  expect(mifsud.getCell(3).value).toBe(2); // called up: seed game 1 + today
  expect(wb.getWorksheet('Intervals')!.rowCount).toBeGreaterThan(20);
});

test('club admin sees all teams but cannot run matches', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Anna Zammit/ }).click();
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('button', { name: 'New match' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Teams & rosters/ })).toBeVisible();
  await page.getByRole('button', { name: /Teams & rosters/ }).click();
  await expect(page.locator('.list-row')).toHaveCount(3);
});

test('practice mode saves nothing', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Mario Borg/ }).click();
  await page.getByRole('button', { name: 'All' }).click();
  await page.getByText('Practice mode').click();
  await page.getByRole('button', { name: /Next/ }).click();
  await page.locator('.lineup-row').first().click();
  await page.getByRole('button', { name: /Go to match \(practice\)/ }).click();
  await expect(page.getByText('PRACTICE')).toBeVisible();
  await page.getByRole('button', { name: 'START' }).click();
  await page.goto('/#/matches');
  await expect(page.locator('.badge.live')).toHaveCount(0);
});

test('head coach sees only assigned age groups', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Joseph Vella/ }).click();
  await expect(page.getByText('Which team is playing?')).toBeVisible();
  await expect(page.locator('.btn.choice')).toHaveText(['U12', 'U14']);
});

test('works fully offline after first load', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload(); // let the SW take control
  await page.getByRole('button', { name: /Mario Borg/ }).click();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'U14 — New Match' })).toBeVisible();
  await page.getByRole('button', { name: 'All' }).click();
  await page.getByRole('button', { name: /Next/ }).click();
  await page.locator('.lineup-row').first().click();
  await page.getByRole('button', { name: 'Go to match' }).click();
  await page.getByRole('button', { name: 'START' }).click();
  await expect(page.locator('.clock.running')).toBeVisible();
  await page.reload();
  await expect(page.locator('.clock.running')).toBeVisible();
});
