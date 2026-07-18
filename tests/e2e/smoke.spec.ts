import { test, expect } from '@playwright/test';

test.describe('public surfaces', () => {
  test('home states the promise and links to demo and request', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('One brief. Every supplier.');
    await expect(page.getByRole('link', { name: 'See the demo' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Start a request' })).toBeVisible();
    await expect(page.getByText('Simulated market — no real businesses are called')).toBeVisible();
  });

  test('demo shows the labeled verified replay and honest framing', async ({ page }) => {
    await page.goto('/demo');
    await expect(page.getByRole('button', { name: 'Play the recorded run' })).toBeVisible();
    await expect(page.getByText('Verified replay — recorded live run, nothing synthesized')).toBeVisible();
    await expect(page.getByText('What is real here')).toBeVisible();
    await expect(page.getByText(/Request fingerprint/)).toBeVisible();
  });

  test('replay reveals tape content when played', async ({ page }) => {
    await page.goto('/demo');
    await page.getByRole('button', { name: 'Play the recorded run' }).click();
    // Within a few seconds of 14x replay, early pins must appear.
    await expect(page.getByText('AI disclosed').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  });

  test('request page offers all three intake paths', async ({ page }) => {
    await page.goto('/request');
    await expect(page.getByRole('tab', { name: 'Voice interview' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Upload a document' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Type it' })).toBeVisible();
    await page.getByRole('tab', { name: 'Type it' }).click();
    await expect(page.getByRole('button', { name: /Build request/ })).toBeVisible();
  });

  test('golden decision room shows deterministic recommendation with evidence rail', async ({ page }) => {
    await page.goto('/demo');
    await page.getByRole('link', { name: 'Open the decision room for this run' }).click();
    await expect(page.getByText('Recommended — deterministic ranking')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Evidence rail')).toBeVisible();
    await expect(page.getByText('All quotes, ranked deterministically')).toBeVisible();
    await expect(page.getByText(/tied-up capital, not a cost/)).toBeVisible();
  });

  test('evidence link from decision room lands on the board with tapes', async ({ page }) => {
    await page.goto('/demo');
    await page.getByRole('link', { name: 'Open the decision room for this run' }).click();
    await page.getByRole('link', { name: /net$/ }).first().click();
    await expect(page).toHaveURL(/\/board\/.+#call=/);
    await expect(page.getByText('Negotiation board')).toBeVisible();
    await expect(page.getByRole('group', { name: /Call tape/ }).first()).toBeVisible({
      timeout: 20_000,
    });
  });
});
