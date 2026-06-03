import { describe, it, expect } from "vitest";
import {
  parseMetadataRef,
  parseLanguageNameRef,
  normalizeExternalIdToken,
  isExternalIdRef,
} from "../../server/routes/objektmallImportRoutes";
import { normalizeLanguage } from "../../server/services/display-name";

// Task #634: enhetstest för de rena parser-hjälparna i objektmall-importen.
// (1) Metadata-referensnamn på rad 1 kan vara klartext, generisk kod eller
//     hybrid "kod:namn". (2) Språkmärkta namnkolumner (namn_sv/name-en/…).
// (3) Normalisering av språkkod för visningsnamn.

describe("parseMetadataRef", () => {
  it("klartext utan kod", () => {
    const r = parseMetadataRef("Gatuadress");
    expect(r.code).toBeNull();
    expect(r.name).toBe("Gatuadress");
    expect(r.raw).toBe("Gatuadress");
  });

  it("ren kod tolkas som namn (kod provas separat mot katalog)", () => {
    const r = parseMetadataRef("22");
    expect(r.code).toBeNull();
    expect(r.name).toBe("22");
  });

  it("hybrid kod:namn delas på första kolon", () => {
    const r = parseMetadataRef("22:Gatuadress");
    expect(r.code).toBe("22");
    expect(r.name).toBe("Gatuadress");
  });

  it("trimmar runt kolon", () => {
    const r = parseMetadataRef("  22 : Gatuadress  ");
    expect(r.code).toBe("22");
    expect(r.name).toBe("Gatuadress");
  });

  it("delar bara på första kolon (namn kan innehålla kolon)", () => {
    const r = parseMetadataRef("22:Tid: start");
    expect(r.code).toBe("22");
    expect(r.name).toBe("Tid: start");
  });

  it("ledande kolon utan kod faller tillbaka till hela strängen som namn", () => {
    const r = parseMetadataRef(":Gatuadress");
    expect(r.code).toBeNull();
    expect(r.name).toBe(":Gatuadress");
  });

  it("tom sträng", () => {
    const r = parseMetadataRef("   ");
    expect(r.code).toBeNull();
    expect(r.name).toBe("");
  });
});

describe("parseLanguageNameRef", () => {
  it("känner igen namn_sv / name_en / objektnamn fi", () => {
    expect(parseLanguageNameRef("namn_sv")).toBe("sv");
    expect(parseLanguageNameRef("name_en")).toBe("en");
    expect(parseLanguageNameRef("objektnamn fi")).toBe("fi");
  });

  it("accepterar bindestreck och versaler", () => {
    expect(parseLanguageNameRef("Namn-EN")).toBe("en");
    expect(parseLanguageNameRef("NAME_SV")).toBe("sv");
  });

  it("ren 'Namn' / 'Name' utan suffix är INTE en språkkolumn (= kolumn E)", () => {
    expect(parseLanguageNameRef("Namn")).toBeNull();
    expect(parseLanguageNameRef("Name")).toBeNull();
    expect(parseLanguageNameRef("Objektnamn")).toBeNull();
  });

  it("icke-namn-kolumner ignoreras", () => {
    expect(parseLanguageNameRef("Gatuadress")).toBeNull();
    expect(parseLanguageNameRef("22:Gatuadress")).toBeNull();
  });
});

describe("normalizeExternalIdToken", () => {
  it("gemener och tar bort mellanslag/_/-", () => {
    expect(normalizeExternalIdToken("Externt ID")).toBe("externtid");
    expect(normalizeExternalIdToken("externt_id")).toBe("externtid");
    expect(normalizeExternalIdToken("Butiks-Nr")).toBe("butiksnr");
  });
});

describe("isExternalIdRef", () => {
  it("känner igen externt-ID-alias (klartext, hybrid, varianter)", () => {
    expect(isExternalIdRef("Externt ID")).toBe(true);
    expect(isExternalIdRef("externt_id")).toBe(true);
    expect(isExternalIdRef("Butiksnummer")).toBe(true);
    expect(isExternalIdRef("butiksnr")).toBe(true);
    // Hybrid "kod:namn" — namn-delen avgör.
    expect(isExternalIdRef("90:Butiksnummer")).toBe(true);
  });

  it("vanliga metadata-kolumner är INTE externt-ID", () => {
    expect(isExternalIdRef("Gatuadress")).toBe(false);
    expect(isExternalIdRef("Kontaktperson")).toBe(false);
    expect(isExternalIdRef("22:Gatuadress")).toBe(false);
  });
});

describe("normalizeLanguage", () => {
  it("normaliserar till gemener", () => {
    expect(normalizeLanguage("SV")).toBe("sv");
    expect(normalizeLanguage(" En ")).toBe("en");
  });

  it("avvisar ogiltiga koder", () => {
    expect(normalizeLanguage("")).toBeUndefined();
    expect(normalizeLanguage(null)).toBeUndefined();
    expect(normalizeLanguage("svenska")).toBeUndefined();
    expect(normalizeLanguage("s")).toBeUndefined();
    expect(normalizeLanguage("12")).toBeUndefined();
  });
});
