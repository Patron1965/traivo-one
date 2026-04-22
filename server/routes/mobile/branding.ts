import { Router, Request, Response } from 'express';
import { IS_MOCK_MODE, plannixFetch, getAuthHeader } from './proxyHelper';

const router = Router();

const PLANNIX_DEFAULT_BRANDING = {
  tenantId: 'plannix-demo',
  companyName: 'Plannix',
  logoUrl: null as string | null,
  colors: {
    primary: '#1B4B6B',
    primaryLight: '#2A6496',
    primaryDark: '#0E2F4A',
    secondary: '#4A9B9B',
    secondaryLight: '#5AABAB',
    accent: '#7DBFB0',
    accentLight: '#B0D9D2',
  },
};

function normalizeBranding(raw: any, fallbackTenantId?: string) {
  if (!raw || typeof raw !== 'object') return null;
  const colorsSrc = raw.colors || raw.theme || {};
  const colors = {
    primary: colorsSrc.primary || colorsSrc.brandPrimary || PLANNIX_DEFAULT_BRANDING.colors.primary,
    primaryLight: colorsSrc.primaryLight || colorsSrc.brandPrimaryLight || PLANNIX_DEFAULT_BRANDING.colors.primaryLight,
    primaryDark: colorsSrc.primaryDark || colorsSrc.brandPrimaryDark || PLANNIX_DEFAULT_BRANDING.colors.primaryDark,
    secondary: colorsSrc.secondary || colorsSrc.brandSecondary || PLANNIX_DEFAULT_BRANDING.colors.secondary,
    secondaryLight: colorsSrc.secondaryLight || PLANNIX_DEFAULT_BRANDING.colors.secondaryLight,
    accent: colorsSrc.accent || colorsSrc.brandAccent || PLANNIX_DEFAULT_BRANDING.colors.accent,
    accentLight: colorsSrc.accentLight || PLANNIX_DEFAULT_BRANDING.colors.accentLight,
  };
  return {
    tenantId: raw.tenantId || raw.tenant_id || fallbackTenantId || PLANNIX_DEFAULT_BRANDING.tenantId,
    companyName: raw.companyName || raw.company_name || raw.tenantName || raw.name || PLANNIX_DEFAULT_BRANDING.companyName,
    logoUrl: raw.logoUrl || raw.logo_url || raw.logo || null,
    colors,
  };
}

router.get('/tenant-branding', async (req: Request, res: Response) => {
  if (IS_MOCK_MODE) {
    res.json({ success: true, branding: PLANNIX_DEFAULT_BRANDING });
    return;
  }

  try {
    const { status, data } = await plannixFetch('/api/tenant-branding', {
      method: 'GET',
      headers: getAuthHeader(req),
    });
    if (status === 200) {
      const normalized = normalizeBranding(data?.branding || data);
      if (normalized) {
        res.json({ success: true, branding: normalized });
        return;
      }
    }
    res.json({ success: true, branding: PLANNIX_DEFAULT_BRANDING, fallback: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'unknown';
    console.error('[LIVE] Tenant branding proxy error:', msg);
    res.json({ success: true, branding: PLANNIX_DEFAULT_BRANDING, fallback: true });
  }
});

export { router as brandingRouter };
