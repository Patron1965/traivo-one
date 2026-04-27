import { test, expect, Page, ElementHandle } from '@playwright/test';

/**
 * E2E verification for task #26: switching tenant branding must update brand
 * colors in-place on every converted screen — no navigation away, no remount.
 * Drives the dev/web test bridge in `BrandingProvider`; event name must stay
 * in sync with `TEST_BRANDING_EVENT` from
 * `client/context/BrandingContext.tsx`.
 *
 * Required converted screens/components (per task description):
 *   Settings, Profile, Statistics, MaterialLog, Inspection, Notifications,
 *   Todo, Team, AIAssistant, MyDeviations, CustomerReports, ReportDeviation,
 *   RouteFeedback, CustomerSignOff, CameraCapture, Signature, OrderDetail,
 *   DayReport, HamburgerMenu, ErrorBoundary, ScreenErrorBoundary.
 */

const TEST_BRANDING_EVENT = 'plannix:set-branding';
const TEST_CRASH_APP_EVENT = 'plannix:test-crash-app';
const TEST_CRASH_SCREEN_INSPECTION_EVENT = 'plannix:test-crash-screen-inspection';

interface ColorPalette {
  primary: string;
  primaryLight: string;
  primaryDark: string;
  secondary: string;
  secondaryLight: string;
  accent: string;
  accentLight: string;
}

const PLANNIX_THEME: ColorPalette = {
  primary: '#1B4B6B',
  primaryLight: '#2A6496',
  primaryDark: '#0E2F4A',
  secondary: '#4A9B9B',
  secondaryLight: '#5AABAB',
  accent: '#7DBFB0',
  accentLight: '#B0D9D2',
};

const RED_THEME: ColorPalette = {
  primary: '#C0392B',
  primaryLight: '#E74C3C',
  primaryDark: '#922B21',
  secondary: '#E67E22',
  secondaryLight: '#F39C12',
  accent: '#F1C40F',
  accentLight: '#F9E79F',
};

const GREEN_THEME: ColorPalette = {
  primary: '#1E8449',
  primaryLight: '#27AE60',
  primaryDark: '#145A32',
  secondary: '#117A65',
  secondaryLight: '#16A085',
  accent: '#52BE80',
  accentLight: '#A9DFBF',
};

async function dispatchBranding(page: Page, colors: ColorPalette, tenantId: string) {
  await page.evaluate(
    ({ eventName, detail }) => {
      window.dispatchEvent(new CustomEvent(eventName, { detail }));
    },
    {
      eventName: TEST_BRANDING_EVENT,
      detail: { colors, tenantId, companyName: tenantId },
    },
  );
  await page.waitForTimeout(150);
}

async function loginIfNeeded(page: Page) {
  await page.goto('/');
  const pinTab = page.locator('[data-testid="button-mode-pin"]');
  if (await pinTab.count()) {
    await pinTab.first().click();
    await page.locator('[data-testid="input-pin"]').first().fill('1234');
    await page.locator('[data-testid="button-login"]').first().click();
    // Wait for tabbed UI / hamburger to appear.
    await page.waitForSelector('[data-testid="button-hamburger-menu"]', { timeout: 15_000 });
  }
}

async function brandColorFingerprint(
  page: Page,
  palette: ColorPalette,
  rootSelector?: string,
): Promise<Record<keyof ColorPalette, number>> {
  return await page.evaluate(
    ({ colors, rootSelector }) => {
      const hexToRgb = (hex: string) => {
        const h = hex.replace('#', '');
        const full = h.length === 3
          ? h.split('').map((c) => c + c).join('')
          : h;
        const r = parseInt(full.slice(0, 2), 16);
        const g = parseInt(full.slice(2, 4), 16);
        const b = parseInt(full.slice(4, 6), 16);
        return { r, g, b };
      };

      const palettePatterns: Record<string, string[]> = {};
      for (const [key, hex] of Object.entries(colors)) {
        const { r, g, b } = hexToRgb(hex as string);
        palettePatterns[key] = [
          (hex as string).toLowerCase(),
          `rgb(${r}, ${g}, ${b})`,
          `rgb(${r},${g},${b})`,
          `rgba(${r}, ${g}, ${b},`,
          `rgba(${r},${g},${b},`,
        ];
      }

      const counts: Record<string, number> = {};
      for (const key of Object.keys(colors)) counts[key] = 0;
      const root = rootSelector ? document.querySelector(rootSelector) : document.body;
      if (!root) return counts as Record<string, number>;

      const nodes = root.querySelectorAll<HTMLElement>('*');
      for (const el of Array.from(nodes)) {
        const style = (el.getAttribute('style') ?? '').toLowerCase();
        const cs = window.getComputedStyle(el);
        const hay = [
          style,
          cs.color,
          cs.backgroundColor,
          cs.borderTopColor,
          cs.borderBottomColor,
          cs.borderLeftColor,
          cs.borderRightColor,
          cs.fill,
          cs.stroke,
        ].join(' ').toLowerCase();
        for (const [key, patterns] of Object.entries(palettePatterns)) {
          for (const p of patterns) {
            if (hay.includes(p)) {
              counts[key] += 1;
              break;
            }
          }
        }
      }
      return counts as Record<string, number>;
    },
    { colors: palette, rootSelector: rootSelector ?? null },
  ) as Record<keyof ColorPalette, number>;
}

/**
 * Sample the computed colors of every themed element under `rootSelector`
 * and return them as a frequency map. Used as a deterministic, format-
 * agnostic comparison: two screens with the *same palette* will have
 * overlapping color-set fingerprints; switching the palette must change
 * the dominant color values.
 */
async function computedColorSet(page: Page, rootSelector: string): Promise<Set<string>> {
  const list = await page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return [] as string[];
    const out: string[] = [];
    const nodes = root.querySelectorAll<HTMLElement>('*');
    for (const el of Array.from(nodes)) {
      const cs = window.getComputedStyle(el);
      for (const v of [cs.color, cs.backgroundColor, cs.borderTopColor, cs.borderLeftColor]) {
        if (v && v !== 'rgba(0, 0, 0, 0)' && v !== 'transparent') out.push(v);
      }
    }
    return out;
  }, rootSelector);
  return new Set(list);
}

function totalHits(fp: Record<string, number>): number {
  return Object.values(fp).reduce((a, b) => a + b, 0);
}

interface ScreenTarget {
  name: string;
  /** Stable testID on the screen's root view. */
  rootTestId: string;
  /** Steps to perform from a baseline (post-login, no modals open). */
  navigate: (page: Page) => Promise<void>;
}

async function ensureClosedHamburger(page: Page) {
  const overlay = page.locator('[data-testid="screen-HamburgerMenu"]');
  if (await overlay.count()) {
    // Click the dimmed backdrop to dismiss.
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(150);
    if (await overlay.count()) {
      // Fallback: tap the overlay area top-left.
      await page.mouse.click(5, 200);
      await page.waitForTimeout(150);
    }
  }
}

async function openHamburger(page: Page) {
  await ensureClosedHamburger(page);
  await page.locator('[data-testid="button-hamburger-menu"]').first().click();
  await page.waitForSelector('[data-testid="screen-HamburgerMenu"]', { timeout: 5_000 });
}

async function tapMenuItem(page: Page, id: string) {
  await page.locator(`[data-testid="button-menu-${id}"]`).first().click();
}

async function goHome(page: Page) {
  await ensureClosedHamburger(page);
  // Bottom tab "Hem".
  const homeBtn = page.getByRole('button', { name: /Hem/ }).first();
  if (await homeBtn.count()) {
    await homeBtn.click();
  }
}

async function goToOrders(page: Page) {
  await ensureClosedHamburger(page);
  await page.getByRole('button', { name: /Uppdrag/ }).first().click();
}

async function openFirstOrderDetail(page: Page) {
  await goToOrders(page);
  // Order cards have testID="card-order-${id}". Pick the first.
  await page.waitForSelector('[data-testid^="card-order-"]', { timeout: 10_000 });
  const card = page.locator('[data-testid^="card-order-"]').first();
  await card.click();
  await page.waitForSelector('[data-testid="screen-OrderDetail"]', { timeout: 10_000 });
}

const CONVERTED_SCREENS: ScreenTarget[] = [
  // Tab-level screens
  {
    name: 'DayReport',
    rootTestId: 'screen-DayReport',
    navigate: async (p) => { await ensureClosedHamburger(p); await p.getByRole('button', { name: /Rapport/ }).first().click(); },
  },
  {
    name: 'Todo',
    rootTestId: 'screen-Todo',
    navigate: async (p) => { await ensureClosedHamburger(p); await p.getByRole('button', { name: /Att göra/ }).first().click(); },
  },
  // Hamburger drawer overlay
  {
    name: 'HamburgerMenu',
    rootTestId: 'screen-HamburgerMenu',
    navigate: async (p) => { await openHamburger(p); },
  },
  // Hamburger-routed screens
  {
    name: 'Profile',
    rootTestId: 'screen-Profile',
    navigate: async (p) => { await openHamburger(p); await tapMenuItem(p, 'profile'); },
  },
  {
    name: 'Settings',
    rootTestId: 'screen-Settings',
    navigate: async (p) => { await openHamburger(p); await tapMenuItem(p, 'settings'); },
  },
  {
    name: 'Statistics',
    rootTestId: 'screen-Statistics',
    navigate: async (p) => { await openHamburger(p); await tapMenuItem(p, 'statistics'); },
  },
  {
    name: 'Notifications',
    rootTestId: 'screen-Notifications',
    navigate: async (p) => { await openHamburger(p); await tapMenuItem(p, 'notifications'); },
  },
  {
    name: 'Team',
    rootTestId: 'screen-Team',
    navigate: async (p) => { await openHamburger(p); await tapMenuItem(p, 'team'); },
  },
  {
    name: 'AIAssistant',
    rootTestId: 'screen-AIAssistant',
    navigate: async (p) => { await openHamburger(p); await tapMenuItem(p, 'ai'); },
  },
  {
    name: 'MyDeviations',
    rootTestId: 'screen-MyDeviations',
    navigate: async (p) => { await openHamburger(p); await tapMenuItem(p, 'deviations'); },
  },
  {
    name: 'CustomerReports',
    rootTestId: 'screen-CustomerReports',
    navigate: async (p) => { await openHamburger(p); await tapMenuItem(p, 'customerReports'); },
  },
  {
    name: 'RouteFeedback',
    rootTestId: 'screen-RouteFeedback',
    navigate: async (p) => { await openHamburger(p); await tapMenuItem(p, 'routeFeedback'); },
  },
  // Order-detail subflows (require navigating into an order first)
  {
    name: 'OrderDetail',
    rootTestId: 'screen-OrderDetail',
    navigate: async (p) => { await openFirstOrderDetail(p); },
  },
  {
    name: 'MaterialLog',
    rootTestId: 'screen-MaterialLog',
    navigate: async (p) => {
      await openFirstOrderDetail(p);
      await p.locator('[data-testid="button-material-log"]').first().click();
      await p.waitForSelector('[data-testid="screen-MaterialLog"]', { timeout: 10_000 });
    },
  },
  {
    name: 'Inspection',
    rootTestId: 'screen-Inspection',
    navigate: async (p) => {
      await openFirstOrderDetail(p);
      await p.locator('[data-testid="button-inspection"]').first().click();
      await p.waitForSelector('[data-testid="screen-Inspection"]', { timeout: 10_000 });
    },
  },
  {
    name: 'ReportDeviation',
    rootTestId: 'screen-ReportDeviation',
    navigate: async (p) => {
      await openFirstOrderDetail(p);
      await p.locator('[data-testid="button-report-deviation"]').first().click();
      await p.waitForSelector('[data-testid="screen-ReportDeviation"]', { timeout: 10_000 });
    },
  },
  {
    name: 'CameraCapture',
    rootTestId: 'screen-CameraCapture',
    navigate: async (p) => {
      await openFirstOrderDetail(p);
      await p.locator('[data-testid="button-camera"]').first().click();
      await p.waitForSelector('[data-testid="screen-CameraCapture"]', { timeout: 10_000 });
    },
  },
  {
    name: 'Signature',
    rootTestId: 'screen-Signature',
    navigate: async (p) => {
      await openFirstOrderDetail(p);
      await p.locator('[data-testid="button-signature"]').first().click();
      await p.waitForSelector('[data-testid="screen-Signature"]', { timeout: 10_000 });
    },
  },
  {
    name: 'CustomerSignOff',
    rootTestId: 'screen-CustomerSignOff',
    navigate: async (p) => {
      await openFirstOrderDetail(p);
      await p.locator('[data-testid="button-customer-signoff"]').first().click();
      await p.waitForSelector('[data-testid="screen-CustomerSignOff"]', { timeout: 10_000 });
    },
  },
];

test.describe('Brand colors update in-place when tenant branding changes', () => {
  test('every converted screen reflects new brand colors without remount', async ({ page }) => {
    test.setTimeout(240_000);

    await loginIfNeeded(page);
    await dispatchBranding(page, PLANNIX_THEME, 'plannix-default');

    for (const screen of CONVERTED_SCREENS) {
      await test.step(`Switches colors in-place on ${screen.name}`, async () => {
        await screen.navigate(page);

        const rootSelector = `[data-testid="${screen.rootTestId}"]`;
        await page.waitForSelector(rootSelector, { timeout: 10_000 });
        await page.waitForTimeout(150);

        // Capture the screen-root element identity *before* the switch.
        // If the screen remounts during branding switch, this DOM node
        // will be detached and a new node will replace it.
        const rootBefore: ElementHandle<Element> | null = await page.$(rootSelector);
        expect(rootBefore, `${screen.name}: root element must exist`).not.toBeNull();
        const root = rootBefore!;

        const fpRedBefore = await brandColorFingerprint(page, RED_THEME, rootSelector);
        const colorSetBefore = await computedColorSet(page, rootSelector);

        await dispatchBranding(page, RED_THEME, 'tenant-red');

        const fpRedAfter = await brandColorFingerprint(page, RED_THEME, rootSelector);
        const fpDefaultAfter = await brandColorFingerprint(page, PLANNIX_THEME, rootSelector);
        const colorSetAfter = await computedColorSet(page, rootSelector);

        // Deterministic check independent of palette format: the set of
        // computed colors under this screen must change when palette flips.
        const symmetricDiff =
          [...colorSetBefore].filter((c) => !colorSetAfter.has(c)).length +
          [...colorSetAfter].filter((c) => !colorSetBefore.has(c)).length;

        // Robust no-remount check: the *exact same DOM node* must still be
        // attached to the document after the branding switch.
        const stillAttached: boolean = await root.evaluate((node) => document.body.contains(node));
        const stillMatchesSelector: boolean = await root.evaluate((node, sel) => node.matches(sel as string), rootSelector);

        expect(
          totalHits(fpRedAfter),
          `${screen.name}: expected red brand colors to appear after dispatch (before=${JSON.stringify(fpRedBefore)}, after=${JSON.stringify(fpRedAfter)})`,
        ).toBeGreaterThan(totalHits(fpRedBefore));
        expect(
          totalHits(fpRedAfter),
          `${screen.name}: red palette should dominate over Plannix default after switch (red=${JSON.stringify(fpRedAfter)}, default=${JSON.stringify(fpDefaultAfter)})`,
        ).toBeGreaterThan(totalHits(fpDefaultAfter));
        expect(
          symmetricDiff,
          `${screen.name}: computed color set must change between palettes (no diff = nothing themed re-rendered)`,
        ).toBeGreaterThan(0);
        expect(
          stillAttached,
          `${screen.name}: screen root element must remain attached (no remount) across branding switch`,
        ).toBe(true);
        expect(
          stillMatchesSelector,
          `${screen.name}: screen root element must keep its testID across branding switch`,
        ).toBe(true);

        // Flip to a second palette to ensure the screen is genuinely live.
        await dispatchBranding(page, GREEN_THEME, 'tenant-green');
        const fpGreen = await brandColorFingerprint(page, GREEN_THEME, rootSelector);
        expect(
          totalHits(fpGreen),
          `${screen.name}: expected green brand colors after second switch (${JSON.stringify(fpGreen)})`,
        ).toBeGreaterThan(0);

        // Reset and return to a stable starting point for the next screen.
        await dispatchBranding(page, PLANNIX_THEME, 'plannix-default');
        await ensureClosedHamburger(page);
        await goHome(page);
        await page.waitForTimeout(150);
      });
    }
  });

  test('ScreenErrorBoundary fallback adopts new brand colors live', async ({ page }) => {
    test.setTimeout(60_000);
    await loginIfNeeded(page);
    await dispatchBranding(page, PLANNIX_THEME, 'plannix-default');

    // Navigate to InspectionScreen so it mounts inside its ScreenErrorBoundary.
    await openFirstOrderDetail(page);
    await page.locator('[data-testid="button-inspection"]').first().click();
    await page.waitForSelector('[data-testid="screen-Inspection"]', { timeout: 10_000 });

    // Trigger the test-only crash inside InspectionScreen — its parent
    // ScreenErrorBoundary catches the error and renders the fallback.
    await page.evaluate((evt) => {
      window.dispatchEvent(new CustomEvent(evt));
    }, TEST_CRASH_SCREEN_INSPECTION_EVENT);

    const retryBtn = page.locator('[data-testid="button-screen-retry"]');
    await retryBtn.waitFor({ state: 'visible', timeout: 10_000 });
    const retryHandle = await retryBtn.elementHandle();
    expect(retryHandle, 'ScreenErrorBoundary fallback should be rendered').not.toBeNull();

    // Sample the fallback's brand-tinted color before/after a switch to
    // RED. The retry button uses Colors.primary as backgroundColor.
    const colorBefore = await retryBtn.evaluate((node) => window.getComputedStyle(node).backgroundColor);

    await dispatchBranding(page, RED_THEME, 'tenant-red');
    await page.waitForTimeout(200);

    const colorAfter = await retryBtn.evaluate((node) => window.getComputedStyle(node).backgroundColor);
    const stillAttached = await retryHandle!.evaluate((node) => document.body.contains(node));

    expect(colorAfter, 'ScreenErrorBoundary retry button color must change after switch').not.toBe(colorBefore);
    expect(stillAttached, 'ScreenErrorBoundary fallback must not remount across the switch').toBe(true);

    await dispatchBranding(page, PLANNIX_THEME, 'plannix-default');
  });

  test('ErrorBoundary (app root) fallback adopts new brand colors live', async ({ page }) => {
    test.setTimeout(60_000);
    await loginIfNeeded(page);
    await dispatchBranding(page, PLANNIX_THEME, 'plannix-default');

    // Trigger the global crash trigger mounted directly inside the root
    // ErrorBoundary — the entire app is replaced by its fallback.
    await page.evaluate((evt) => {
      window.dispatchEvent(new CustomEvent(evt));
    }, TEST_CRASH_APP_EVENT);

    const restartBtn = page.locator('[data-testid="button-restart"]');
    await restartBtn.waitFor({ state: 'visible', timeout: 10_000 });
    const restartHandle = await restartBtn.elementHandle();
    expect(restartHandle, 'Root ErrorBoundary fallback should be rendered').not.toBeNull();

    const colorBefore = await restartBtn.evaluate((node) => window.getComputedStyle(node).backgroundColor);

    await dispatchBranding(page, RED_THEME, 'tenant-red');
    await page.waitForTimeout(200);

    const colorAfter = await restartBtn.evaluate((node) => window.getComputedStyle(node).backgroundColor);
    const stillAttached = await restartHandle!.evaluate((node) => document.body.contains(node));

    expect(colorAfter, 'ErrorBoundary restart button color must change after switch').not.toBe(colorBefore);
    expect(stillAttached, 'ErrorBoundary fallback must not remount across the switch').toBe(true);
  });
});
