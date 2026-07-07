import { describe, it, expect } from "vitest";
import { autoMatchColumn } from "../../server/services/object-import-core";
import { pivotLongMetadataMatrix } from "../../client/src/components/import/ObjectImportV2Flow";

describe("Tre-fils-export ↔ återimport (Task #1176)", () => {
  describe("KNOWN_FIELDS-alias för Fil 1 / Fil 2", () => {
    it("mappar Fil 1-kolumner till rätt importmål", () => {
      expect(autoMatchColumn("Objektnummer")).toBe("system_id");
      expect(autoMatchColumn("Objektnamn")).toBe("name");
      expect(autoMatchColumn("Status")).toBe("active_status");
      expect(autoMatchColumn("Släktnamn")).toBe("__empty");
    });

    it("mappar Fil 2-kolumner till rätt importmål", () => {
      expect(autoMatchColumn("Huvudobjekt")).toBe("system_id");
      expect(autoMatchColumn("Namn")).toBe("name");
      expect(autoMatchColumn("Koppling uppåt")).toBe("system_parent_id");
    });
  });

  describe("pivotLongMetadataMatrix (Fil 3 långformat → brett)", () => {
    it("pivoterar en rad per objekt+fält till en rad per objekt med metadata.*-kolumner", () => {
      const matrix = [
        ["Objektnummer", "Objektnamn", "Släktnamn", "Metadatafält", "Data"],
        ["OBJ-1", "Hus A", "Stad › Hus A", "Adress", "Storgatan 1"],
        ["OBJ-1", "Hus A", "Stad › Hus A", "Stad", "Stockholm"],
        ["OBJ-2", "Hus B", "Stad › Hus B", "Adress", "Storgatan 2"],
      ];
      const out = pivotLongMetadataMatrix(matrix)!;
      expect(out).not.toBeNull();
      expect(out[0]).toEqual(["Objektnummer", "Objektnamn", "metadata.Adress", "metadata.Stad"]);
      expect(out[1]).toEqual(["OBJ-1", "Hus A", "Storgatan 1", "Stockholm"]);
      expect(out[2]).toEqual(["OBJ-2", "Hus B", "Storgatan 2", ""]);
    });

    it("returnerar null för brett format (ingen Metadatafält/Data-kolumn)", () => {
      const matrix = [
        ["Objektnummer", "Objektnamn", "metadata.Adress"],
        ["OBJ-1", "Hus A", "Storgatan 1"],
      ];
      expect(pivotLongMetadataMatrix(matrix)).toBeNull();
    });

    it("hoppar över rader utan objektnummer eller fältnamn", () => {
      const matrix = [
        ["Objektnummer", "Objektnamn", "Metadatafält", "Data"],
        ["", "Hus A", "Adress", "x"],
        ["OBJ-1", "Hus A", "", "y"],
        ["OBJ-1", "Hus A", "Adress", "Storgatan 1"],
      ];
      const out = pivotLongMetadataMatrix(matrix)!;
      expect(out).toEqual([
        ["Objektnummer", "Objektnamn", "metadata.Adress"],
        ["OBJ-1", "Hus A", "Storgatan 1"],
      ]);
    });
  });
});
