import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { accounts, expect, test, type Account } from './support/fixtures';

/**
 * Automated WCAG 2.1 A/AA checks (axe-core) on the main screens, in mock mode:
 * sign-in, the staff shell (sidebar, topbar, account menu, command palette),
 * the dashboard, records lists and a record, users admin, and the end-user
 * portal. Each screen is scanned in the dark look, the light look, and once in
 * Arabic (right to left), and every scan must come back with zero violations.
 *
 * axe catches what a machine can: names, roles, contrast, landmarks. Keyboard
 * behaviour (focus moving into and back out of the menus and the palette) is
 * asserted by hand in the last tests here.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

type Look = { name: string; theme: 'dark' | 'light'; lang: 'en' | 'ar' };
const LOOKS: Look[] = [
  { name: 'dark', theme: 'dark', lang: 'en' },
  { name: 'light', theme: 'light', lang: 'en' },
  { name: 'arabic (rtl)', theme: 'dark', lang: 'ar' },
];

/** Stored before the app loads, the way the theme toggle and language picker leave them. */
async function applyLook(page: Page, look: Look) {
  await page.addInitScript(({ theme, lang }) => {
    // Only the first load: a test that switches theme later keeps its choice.
    if (sessionStorage.getItem('arcus.a11y.look') !== null) return;
    sessionStorage.setItem('arcus.a11y.look', theme);
    localStorage.setItem('arcus.theme', theme);
    localStorage.setItem(
      'arcus.ui',
      JSON.stringify({ state: { sidebarCollapsed: false, theme, publicTheme: theme }, version: 0 }),
    );
    localStorage.setItem('arcus.lang', lang);
  }, look);
}

/**
 * Scan the page and return the violations as readable lines, so a failure
 * says which rule broke where without opening the trace.
 */
async function scan(page: Page, label: string): Promise<string[]> {
  // Let the page-in fade and any skeletons settle: axe measures contrast on
  // what is painted, and a half-faded element reads as low contrast.
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return results.violations.flatMap((v) =>
    v.nodes.map(
      (n) => `[${label}] ${v.id} (${v.impact}): ${n.target.join(' ')} — ${n.failureSummary?.split('\n').slice(1).join(' ').trim()}`,
    ),
  );
}

/**
 * Sign in by the form's ids rather than its labels, which are in Arabic in
 * the right-to-left run.
 */
async function signIn(page: Page, account: Account) {
  await page.goto('/login');
  await page.locator('#login').fill(account.login);
  await page.locator('#password').fill(account.password);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname !== '/login');
}

/** Open the first link on the page whose href matches, i.e. the first row of a list. */
async function openFirst(page: Page, href: RegExp) {
  const links = page.locator('a[href]');
  await expect(links.first()).toBeVisible();
  const count = await links.count();
  for (let i = 0; i < count; i++) {
    const link = links.nth(i);
    const value = (await link.getAttribute('href')) ?? '';
    if (href.test(value) && (await link.isVisible())) {
      await link.click();
      await page.waitForURL((url) => href.test(url.pathname));
      return;
    }
  }
  throw new Error(`no visible link matching ${href}`);
}

for (const look of LOOKS) {
  test.describe(`axe, ${look.name}`, { tag: '@mock' }, () => {
    test.beforeEach(async ({ page }) => {
      await applyLook(page, look);
    });

    test('sign-in', async ({ page }) => {
      // Each scan waits for the page to settle; on a slow machine running the
      // whole suite in parallel, two of them pass the 30 s default.
      test.setTimeout(90_000);
      await page.goto('/login');
      await expect(page.locator('form')).toBeVisible();
      const problems = await scan(page, 'login');
      // The same form after a failed submit: the errors must be announced too.
      await page.locator('form button[type="submit"]').click();
      problems.push(...(await scan(page, 'login, empty submit')));
      await page.goto('/register');
      await expect(page.locator('form')).toBeVisible();
      problems.push(...(await scan(page, 'register')));
      expect(problems).toEqual([]);
    });

    test('staff shell, dashboard, records, users', async ({ page }) => {
      test.setTimeout(240_000);
      await signIn(page, accounts.staff());
      const problems: string[] = [];

      // Staff land on the dashboard; no reload, which would cut its requests off mid-flight.
      if (new URL(page.url()).pathname !== '/dashboard') await page.goto('/dashboard');
      // The first screen loads its lazy chunk: allow for a slow machine.
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 });
      problems.push(...(await scan(page, 'dashboard')));

      // The account menu, open.
      await page.locator('header button[aria-haspopup="menu"]').click();
      await expect(page.getByRole('menu')).toBeVisible();
      problems.push(...(await scan(page, 'account menu')));
      await page.keyboard.press('Escape');

      // The command palette, open.
      await page.keyboard.press('Control+k');
      await expect(page.getByRole('dialog')).toBeVisible();
      problems.push(...(await scan(page, 'command palette')));
      await page.keyboard.press('Escape');

      await page.goto('/records');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      problems.push(...(await scan(page, 'records')));

      await page.goto('/records/Organization');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByRole('row').nth(1)).toBeVisible();
      problems.push(...(await scan(page, 'records/Organization')));

      await openFirst(page, /^\/records\/Organization\/\d+$/);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      problems.push(...(await scan(page, 'an organization')));

      // The incident screen.
      await page.goto('/incidents/1042');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      problems.push(...(await scan(page, 'an incident')));

      await page.goto('/users');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      problems.push(...(await scan(page, 'users')));
      await openFirst(page, /^\/users\/[^/]+$/);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      problems.push(...(await scan(page, 'a user')));

      // Organisation admin: every tab, the branding preview included.
      await page.goto('/organisation');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      for (const tab of ['orgs', 'teams', 'users', 'branding', 'domains']) {
        await page.getByRole('tab').nth(['orgs', 'teams', 'users', 'branding', 'domains'].indexOf(tab)).click();
        await expect(page.getByRole('tabpanel')).toBeVisible();
        problems.push(...(await scan(page, `organisation admin: ${tab}`)));
      }

      expect(problems).toEqual([]);
    });

    test('end-user portal', async ({ page }) => {
      test.setTimeout(180_000);
      await signIn(page, accounts.portal());
      const problems: string[] = [];

      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      problems.push(...(await scan(page, 'portal home')));

      await page.goto('/portal/requests');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      problems.push(...(await scan(page, 'my requests')));
      // The rows are not links: open the first by keyboard, which is also
      // the check that a clickable row can be reached and used without a mouse.
      const firstRow = page.locator('tbody tr').first();
      await firstRow.focus();
      await page.keyboard.press('Enter');
      await page.waitForURL(/\/portal\/requests\/\d+$/);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      problems.push(...(await scan(page, 'a request')));

      await page.goto('/portal/new');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      problems.push(...(await scan(page, 'new request')));

      expect(problems).toEqual([]);
    });
  });
}

/**
 * True when the focused element (or the Input wrapper around it, which draws
 * the focus for its bare <input>) shows an outline or a ring.
 */
const FOCUS_DRAWN = `(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return true;
  const drawn = (node) => {
    const s = getComputedStyle(node);
    return (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none';
  };
  return drawn(el) || drawn(el.closest('.group') ?? el);
})()`;

/* ---------------------------------------------------------------------------
   Keyboard: what axe cannot see.
   ------------------------------------------------------------------------ */

test.describe('keyboard', { tag: '@mock' }, () => {
  test('command palette: focus moves in, Tab stays in, Escape closes and returns focus', async ({ page }) => {
    await signIn(page, accounts.staff());
    await page.goto('/dashboard');
    const trigger = page.locator('header button').filter({ has: page.locator('kbd') });
    await trigger.focus();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog', { name: 'Search and navigate' });
    const input = dialog.getByRole('combobox');
    await expect(input).toBeFocused();
    // Arrow keys move the active option without moving focus off the input.
    await page.keyboard.press('ArrowDown');
    await expect(input).toHaveAttribute('aria-activedescendant', /.+/);
    await expect(input).toBeFocused();
    // Modal: Tab does not escape to the page behind.
    await page.keyboard.press('Tab');
    await expect(input).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('account menu: opens onto its first item, arrows move, Escape returns to the button', async ({ page }) => {
    await signIn(page, accounts.staff());
    await page.goto('/dashboard');
    const button = page.locator('header button[aria-haspopup="menu"]');
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(button).toHaveAttribute('aria-expanded', 'true');

    const items = page.getByRole('menu').getByRole('menuitem');
    await expect(items.first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(items.first()).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(button).toBeFocused();
  });

  test('sign-in: focus is visible on every control', async ({ page }) => {
    await page.goto('/login');
    // Tab through the form: each focused control draws an outline or a ring.
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      // A string, since the specs compile without the DOM types.
      const visible = await page.evaluate<boolean>(FOCUS_DRAWN);
      expect(visible, `focus indicator on tab stop ${i + 1}`).toBe(true);
    }
  });
});
