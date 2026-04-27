import React, { createContext, useContext, useEffect, useState, useCallback, useRef, useMemo, ReactNode } from 'react';
import { Platform } from 'react-native';
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

/**
 * Name of the DOM event the dev/web test bridge listens for. Tests dispatch
 * `new CustomEvent(TEST_BRANDING_EVENT, { detail: { colors } })` to switch
 * the active brand colors in-place without hitting the server.
 */
export const TEST_BRANDING_EVENT = 'plannix:set-branding';

export interface TestBrandingEventDetail {
  colors: Partial<TenantBrandingColors>;
  tenantId?: string;
  companyName?: string;
  logoUrl?: string | null;
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

/**
 * Memoized themed StyleSheet factory. The factory is re-run whenever the
 * tenant's brand colors change, so any style that reads from `Colors.primary`
 * etc. inside the factory will reflect the current tenant without remounting
 * the screen. Use this for primary screens that should react instantly to
 * branding switches (Home, Orders, Map, Login, TabNavigator).
 */
export function useThemedStyles<T>(factory: (colors: TenantBrandingColors) => T): T {
  const colors = useThemeColors();
  return useMemo(() => factory(colors), [colors, factory]);
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
  const lastAppliedColorsRef = useRef<TenantBrandingColors>(PLANNIX_DEFAULT_BRAND_COLORS);
  // Monotonically increasing request id; in-flight responses for older
  // tenants are discarded to avoid cross-tenant branding flicker on
  // rapid tenant switches.
  const requestIdRef = useRef(0);

  const tenantId = user?.tenantId || null;

  const applyBranding = useCallback((b: TenantBranding) => {
    // Always push to the mutable theme store so components reading
    // `Colors.primary` directly (without a hook) still see fresh values
    // on next evaluation.
    setBrandColors(b.colors);
    if (!colorsEqual(b.colors, lastAppliedColorsRef.current)) {
      lastAppliedColorsRef.current = b.colors;
      // New colors object reference -> hooks (useThemeColors /
      // useThemedStyles) re-run and primary screens update in place
      // without losing scroll/state.
      setBrandingState(b);
    } else {
      // Keep object identity stable when nothing changed so memoized
      // styles don't get recomputed unnecessarily.
      setBrandingState(prev => (prev.tenantId === b.tenantId && prev.companyName === b.companyName && prev.logoUrl === b.logoUrl ? prev : { ...prev, ...b, colors: prev.colors }));
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

  // Test-only branding switch bridge. Lets automated UI tests on the web
  // build push a new branding object via a DOM event without depending on
  // the server, so we can verify all converted screens react in place.
  // Active only on web in __DEV__ so it never ships in production bundles.
  useEffect(() => {
    if (!__DEV__) return;
    if (Platform.OS !== 'web') return;
    const w: Window | undefined =
      typeof window !== 'undefined' && typeof window.addEventListener === 'function' ? window : undefined;
    if (!w) return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<TestBrandingEventDetail>).detail;
      const colors = detail?.colors;
      if (!colors || typeof colors !== 'object') return;
      const next: TenantBranding = {
        tenantId: detail.tenantId ?? `test-${Date.now()}`,
        companyName: detail.companyName ?? 'Test Tenant',
        logoUrl: detail.logoUrl ?? null,
        colors: { ...PLANNIX_DEFAULT_BRAND_COLORS, ...colors },
      };
      // Bypass server fetch / cache: apply directly so the test sees an
      // immediate, in-place re-render across all live-themed screens.
      requestIdRef.current++; // discard any in-flight loadBranding response
      applyBranding(next);
    };
    w.addEventListener(TEST_BRANDING_EVENT, handler as EventListener);
    return () => w.removeEventListener(TEST_BRANDING_EVENT, handler as EventListener);
  }, [applyBranding]);

  return (
    <BrandingContext.Provider value={{ branding, isLoading, refresh: loadBranding }}>
      {children}
    </BrandingContext.Provider>
  );
}
