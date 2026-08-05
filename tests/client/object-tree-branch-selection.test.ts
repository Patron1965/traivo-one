// Task #1398: trädvyns explicita gren-selektion — computeBranchSeedRoots
// härleder minimala helt täckta gren-rötter för orderkoncept-seed (wizardens
// server-resolver expanderar varje id till hela dess subträd).
import { describe, it, expect } from "vitest";
import { computeBranchSeedRoots } from "../../client/src/components/objectTree/ObjectHierarchyTree";

type N = { id: string; parentId: string | null };

const tree: N[] = [
  { id: "axfood", parentId: null },
  { id: "region-vast", parentId: "axfood" },
  { id: "butik-a", parentId: "region-vast" },
  { id: "butik-b", parentId: "region-vast" },
  { id: "region-ost", parentId: "axfood" },
  { id: "kortedala", parentId: "region-ost" },
  { id: "butik-c", parentId: "region-ost" },
  { id: "annan-rot", parentId: null },
];

describe("computeBranchSeedRoots", () => {
  it("hel gren vald → endast gren-roten", () => {
    const sel = new Set(["axfood", "region-vast", "butik-a", "butik-b", "region-ost", "kortedala", "butik-c"]);
    expect(computeBranchSeedRoots(tree, sel)).toEqual(["axfood"]);
  });

  it("avmarkerat barn → delvis täckta föräldrar ersätts av helt täckta ättlingar", () => {
    const sel = new Set(["axfood", "region-vast", "butik-a", "butik-b", "region-ost", "butik-c"]);
    // kortedala avmarkerad → axfood och region-ost är delvis täckta och får
    // INTE seedas (expansion skulle åter-inkludera kortedala).
    const roots = computeBranchSeedRoots(tree, sel);
    expect(roots.sort()).toEqual(["butik-c", "region-vast"].sort());
  });

  it("tom selektion → inga rötter", () => {
    expect(computeBranchSeedRoots(tree, new Set())).toEqual([]);
  });

  it("valda id:n som saknas i trädet tas med som egna rötter", () => {
    const sel = new Set(["butik-a", "utanfor-tradet"]);
    const roots = computeBranchSeedRoots(tree, sel);
    expect(roots.sort()).toEqual(["butik-a", "utanfor-tradet"].sort());
  });

  it("enskilt löv valt → lövet självt", () => {
    expect(computeBranchSeedRoots(tree, new Set(["kortedala"]))).toEqual(["kortedala"]);
  });
});
