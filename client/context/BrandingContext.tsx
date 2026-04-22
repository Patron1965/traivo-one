import React, { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode, Fragment } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiRequest } from '../lib/query-client';
import { setBrandColors, resetBrandColors, PLANNIX_DEFAULT_BRAND_COLORS, BrandColors } from '../constants/theme';
import { useAuth } from './AuthContext';

export type TenantBrandingColors = BrandColors;

export interface TenantBranding {
  tenantId: string;
  companyName: string;
  logoUrl: string | null;
  colors: TenantBrandingColors;
}

const PLANNIX_DEFAULT_BRANDING: TenantBranding = {
  tenantId: 'plannix-default',
  companyName: 'Plannix',
  logoUrl: null,
  colors: { ...PLANNIX_DEFAULT_BRAND_COLORS },
};

const BRANDING_CACHE_PREFIX = '@tenant_branding:';
const BRANDING_LAST_TENANT_KEY = '@tenant_branding_last_tenant';

interface BrandingContextValue {
  branding: TenantBranding;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

const BrandingContext = createContext<BrandingContextValue>({
  branding: PLANNIX_DEFAULT_BRANDING,
  isLoading: false,
  refresh: async () => {},
});

export function useBranding() {
  return useContext(BrandingContext);
}

/**
 * Returns the current tenant's brand colors. Use this at render time when a
 * style needs to react to tenant switches without remount. For non-brand
 * surfaces, importing `Colors` from theme.ts is fine — its brand fields are
 * getter-backed and always return the current tenant value.
 */
export function useThemeColors(): TenantBrandingColors {
  return useContext(BrandingContext).branding.colors;
}

function colorsEqual(a: TenantBrandingColors, b: TenantBrandingColors): boolean {
  return (
    a.primary === b.primary &&
    a.primaryLight === b.primaryLight &&
    a.primaryDark === b.primaryDark &&
    a.secondary === b.secondary &&
    a.secondaryLight === b.secondaryLight &&
    a.accent === b.accent &&
    a.accentLight === b.accentLight
  );
}

async function readCache(tenantId: string): Promise<TenantBranding | null> {
  try {
    const raw = await AsyncStorage.getItem(BRANDING_CACHE_PREFIX + tenantId);
    return raw ? (JSON.parse(raw) as TenantBranding) : null;
  } catch {
    return null;
  }
}

async function writeCache(tenantId: string, b: TenantBranding) {
  try {
    await AsyncStorage.setItem(BRANDING_CACHE_PREFIX + tenantId, JSON.stringify(b));
    await AsyncStorage.setItem(BRANDING_LAST_TENANT_KEY, tenantId);
  } catch {}
}

async function readLastTenantBranding(): Promise<TenantBranding | null> {
  try {
    const last = await AsyncStorage.getItem(BRANDING_LAST_TENANT_KEY);
    if (!last) return null;
    return await readCache(last);
  } catch {
    return null;
  }
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const { user, token } = useAuth();
  const [branding, setBrandingState] = useState<TenantBranding>(PLANNIX_DEFAULT_BRANDING);
  const [isLoading, setIsLoading] = useState(false);
  // Bumped only when brand colors actually change. Used as `key` on the
  // children subtree so any module-scoped StyleSheet.create snapshots are
  // recreated with the new Colors values, giving real app-wide runtime
  // theming on every brand switch (paired with getter-backed Colors so even
  // already-evaluated reads stay correct).
  const [themeVersion, setThemeVersion] = useState(0);
  const lastAppliedColorsRef = useRef<TenantBrandingColors>(PLANNIX_DEFAULT_BRAND_COLORS);
  // Monotonically increasing request id; in-flight responses for older
  // tenants are discarded to avoid cross-tenant branding flicker on
  // rapid tenant switches.
  const requestIdRef = useRef(0);

  const tenantId = user?.tenantId || null;

  const applyBranding = useCallback((b: TenantBranding) => {
    setBrandingState(b);
    if (!colorsEqual(b.colors, lastAppliedColorsRef.current)) {
      setBrandColors(b.colors);
      lastAppliedColorsRef.current = b.colors;
      setThemeVersion(v => v + 1);
    } else {
      setBrandColors(b.colors);
    }
  }, []);

  // On startup (no token yet), restore last-known branding so the login
  // screen remains white-labeled even when offline / before sign-in.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await readLastTenantBranding();
      if (!cancelled && cached) applyBranding(cached);
    })();
    return () => { cancelled = true; };
  }, [applyBranding]);

  const loadBranding = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    const activeTenantId = tenantId;
    const myRequestId = ++requestIdRef.current;
    const isStale = () => requestIdRef.current !== myRequestId;

    // Step 1: when active tenant changes, never keep the previous tenant's
    // branding visible. Show this tenant's cache if any, else Plannix default.
    let resolvedFromCache: TenantBranding | null = null;
    if (activeTenantId) {
      resolvedFromCache = await readCache(activeTenantId);
      if (isStale()) return;
      if (resolvedFromCache) {
        applyBranding(resolvedFromCache);
      } else {
        // No cached branding for this tenant — start from Plannix defaults so
        // we never show another tenant's colors/logo while we fetch.
        resetBrandColors();
        applyBranding(PLANNIX_DEFAULT_BRANDING);
      }
    }

    // Step 2: fetch fresh branding. On any failure, fall back deterministically
    // to cached(activeTenant) ?? Plannix default — never retain prior tenant.
    try {
      const data = await apiRequest('GET', '/api/mobile/tenant-branding', undefined, token);
      if (isStale()) return;
      if (data?.success && data.branding) {
        const fresh: TenantBranding = {
          ...PLANNIX_DEFAULT_BRANDING,
          ...data.branding,
          tenantId: activeTenantId || data.branding.tenantId || PLANNIX_DEFAULT_BRANDING.tenantId,
          colors: { ...PLANNIX_DEFAULT_BRANDING.colors, ...(data.branding.colors || {}) },
        };
        applyBranding(fresh);
        // Cache under the active tenant id (from auth) so the next boot
        // hits even when upstream omits the id. Also mirror under the
        // upstream id when it differs, without deleting other tenants'
        // caches (multi-tenant users keep all their brandings cached).
        if (activeTenantId) await writeCache(activeTenantId, fresh);
        if (data.branding.tenantId && data.branding.tenantId !== activeTenantId) {
          await writeCache(data.branding.tenantId, { ...fresh, tenantId: data.branding.tenantId });
        }
      }
    } catch (err) {
      if (isStale()) return;
      console.log('Tenant branding fetch failed, using fallback:', err);
      const fallback = resolvedFromCache ?? PLANNIX_DEFAULT_BRANDING;
      applyBranding(fallback);
    } finally {
      if (!isStale()) setIsLoading(false);
    }
  }, [token, tenantId, applyBranding]);

  useEffect(() => {
    if (token) loadBranding();
  }, [token, tenantId, loadBranding]);

  return (
    <BrandingContext.Provider value={{ branding, isLoading, refresh: loadBranding }}>
      <Fragment key={themeVersion}>{children}</Fragment>
    </BrandingContext.Provider>
  );
}
