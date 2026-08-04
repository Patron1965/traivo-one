import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { createElement, type ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider } from "@/components/ui/sidebar";
import { LanguageProvider } from "@/hooks/use-language";

// This file is intentionally authored as plain `.ts` with React.createElement
// instead of `.tsx`/JSX: the current vitest (oxc) test transform fails to parse
// JSX in client test files, while plain TS parses fine.
const h = createElement;

// Hoisted mutable state shared with the mocked hooks below. vi.hoisted ensures
// the object exists before the vi.mock factories run.
const state = vi.hoisted(() => ({
  navEnabled: new Set<string>(),
  allEnabled: false,
  user: {
    id: "u1",
    role: "owner",
    tenantId: "kinab",
    email: "owner@test.se",
    firstName: null as string | null,
    lastName: null as string | null,
    profileImageUrl: null as string | null,
  },
}));

// Mock auth so we control the role used for menu-/role-gating.
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: state.user, isLoading: false }),
}));

// Mock feature-context so we can drive module-/feature-gating per nav URL.
vi.mock("@/lib/feature-context", () => ({
  useFeatures: () => ({
    enabledModules: [],
    packageTier: "premium",
    isModuleEnabled: () => true,
    isNavItemEnabled: (url: string) => state.allEnabled || state.navEnabled.has(url),
    isLoading: false,
  }),
  FeatureProvider: ({ children }: { children: ReactNode }) => children,
}));

// Mock tenant branding + heavy header widgets that TopNav renders but that are
// irrelevant to nav-group rendering.
vi.mock("@/components/TenantBrandingProvider", () => ({
  useTenantBranding: () => ({ logoUrl: null, companyName: "Test AB" }),
  TenantBrandingProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/GlobalAIButton", () => ({ GlobalAIButton: () => null }));
vi.mock("@/components/TourMenu", () => ({ TourMenu: () => null }));
vi.mock("@/components/LanguageSwitcher", () => ({ LanguageSwitcher: () => null }));
vi.mock("@/components/ThemeToggle", () => ({ ThemeToggle: () => null }));

import { TopNav } from "@/components/layout/TopNav";
import { MobileNav } from "@/components/layout/MobileNav";
import { AppSidebar } from "@/components/layout/AppSidebar";

// The AI nav group (group key "ai", label "AI", access group "analys").
const AI_URLS = ["/ai-assistant", "/predictive-planning", "/predictive-maintenance"];

// Other groups (Swedish default labels) that must disappear when fully filtered.
const OTHER_GROUP_LABELS = ["Ordrar", "Planering", "Fält", "Ekonomi", "Grunddata", "Admin"];
const OTHER_GROUP_SLUGS = ["ordrar", "planering", "fält", "ekonomi", "grunddata", "admin"];

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        staleTime: Infinity,
        queryFn: async () => [],
      },
      mutations: { retry: false },
    },
  });
}

function renderUI(ui: ReactNode) {
  const { hook } = memoryLocation({ path: "/" });
  return render(
    h(
      QueryClientProvider,
      { client: makeClient() },
      h(
        LanguageProvider,
        null,
        h(
          TooltipProvider,
          null,
          h(SidebarProvider, null, h(Router, { hook }, ui)),
        ),
      ),
    ),
  );
}

beforeEach(() => {
  state.navEnabled = new Set();
  state.allEnabled = false;
  state.user.role = "owner";
  state.user.tenantId = "kinab";
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("TopNav nav groups", () => {
  it("does not render a dropdown trigger for a group whose filtered items are all empty", () => {
    // Only the AI group's items are feature-enabled; every other group filters to zero.
    state.navEnabled = new Set(AI_URLS);

    renderUI(h(TopNav));

    // Group with at least one visible item still renders its trigger.
    expect(screen.queryByTestId("nav-dropdown-ai")).toBeTruthy();

    // Fully-filtered groups must not render any trigger/group.
    // (Planering renderas som direktlänk när den har items — kolla båda testid:n.)
    for (const slug of OTHER_GROUP_SLUGS) {
      expect(
        screen.queryByTestId(`nav-dropdown-${slug}`),
        `expected nav-dropdown-${slug} to be absent`,
      ).toBeNull();
      expect(
        screen.queryByTestId(`nav-link-${slug}`),
        `expected nav-link-${slug} to be absent`,
      ).toBeNull();
    }
  });

  it("renders dropdown triggers for all accessible groups when items are enabled", () => {
    state.allEnabled = true;

    renderUI(h(TopNav));

    for (const slug of ["ai", ...OTHER_GROUP_SLUGS]) {
      // "Planering" renderas numera som direktlänk (NavDirectLink) i stället
      // för dropdown — den har testid nav-link-planering.
      const testId =
        slug === "planering" ? `nav-link-${slug}` : `nav-dropdown-${slug}`;
      expect(
        screen.queryByTestId(testId),
        `expected ${testId} to be present`,
      ).toBeTruthy();
    }
  });
});

// Group titles in MobileNav render as <h3> headings; item titles render as
// <span>/<a>. Scope assertions to headings so we don't match item labels that
// happen to share text with a group (e.g. the "Ekonomi" group vs the
// "/economics" item).
function mobileGroupHeadings(): string[] {
  const menu = screen.getByTestId("mobile-nav-menu");
  return Array.from(menu.querySelectorAll("h3")).map(
    (el) => el.textContent?.trim() ?? "",
  );
}

describe("MobileNav nav groups", () => {
  it("does not render a group heading when its filtered items are all empty", () => {
    state.navEnabled = new Set(AI_URLS);

    renderUI(h(MobileNav));
    fireEvent.click(screen.getByTestId("button-mobile-menu"));

    const headings = mobileGroupHeadings();

    // Group with a visible item renders its heading.
    expect(headings).toContain("AI");

    // Fully-filtered groups render no heading.
    for (const label of OTHER_GROUP_LABELS) {
      expect(headings, `expected group heading "${label}" to be absent`).not.toContain(
        label,
      );
    }
  });

  it("renders group headings for accessible groups when items are enabled", () => {
    state.allEnabled = true;

    renderUI(h(MobileNav));
    fireEvent.click(screen.getByTestId("button-mobile-menu"));

    const headings = mobileGroupHeadings();

    for (const label of ["AI", ...OTHER_GROUP_LABELS]) {
      expect(headings, `expected group heading "${label}" to be present`).toContain(
        label,
      );
    }
  });
});

describe("AppSidebar nav groups", () => {
  it("does not render a collapsible group when its filtered items are all empty", () => {
    state.navEnabled = new Set(AI_URLS);

    renderUI(h(AppSidebar));

    // Group with a visible item still renders.
    expect(screen.queryByTestId("nav-group-ai")).toBeTruthy();

    // Fully-filtered groups must not render.
    for (const slug of OTHER_GROUP_SLUGS) {
      expect(
        screen.queryByTestId(`nav-group-${slug}`),
        `expected nav-group-${slug} to be absent`,
      ).toBeNull();
    }
  });

  it("renders collapsible groups for accessible groups when items are enabled", () => {
    state.allEnabled = true;

    renderUI(h(AppSidebar));

    for (const slug of ["ai", ...OTHER_GROUP_SLUGS]) {
      expect(
        screen.queryByTestId(`nav-group-${slug}`),
        `expected nav-group-${slug} to be present`,
      ).toBeTruthy();
    }
  });
});
