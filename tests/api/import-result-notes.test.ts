// Task #1364: klassning av persisterade execute-radnoteringar till
// resultatlistorna became_root_rows / skipped_equipment_rows.
import { describe, expect, it } from "vitest";
import { classifyExecuteRowNotes } from "../../server/services/import-result-notes";

describe("classifyExecuteRowNotes", () => {
  it("listar bara äkta rot-ifierade skapade rader — inte uppdaterings-rader med behållen placering", () => {
    const rows = [
      // Äkta ny toppnivå (create med ej-resolverbar förälder).
      {
        rowNumber: 2,
        status: "imported",
        validationMsgs: [
          {
            field: "execute",
            message: 'Föräldern kunde inte hittas (system_parent_id="OBJ-999", interim_parent_id="") — objektet importerades som topphierarki (rot).',
            severity: "warning",
            code: "became_root",
          },
        ],
        objectId: "obj-a",
        objectName: "Butik Nord",
        rawData: { "0": "Butik Nord" },
      },
      // UPDATE-rad med ej-resolverbar förälder: placeringen behålls — får INTE listas som ny toppnivå.
      {
        rowNumber: 3,
        status: "imported",
        validationMsgs: [
          {
            field: "execute",
            message: 'Föräldern kunde inte hittas (system_parent_id="OBJ-998", interim_parent_id="") — objektets befintliga placering behålls.',
            severity: "warning",
            code: "kept_existing_placement",
          },
        ],
        objectId: "obj-b",
        objectName: "Befintligt objekt",
        rawData: { "0": "Befintligt objekt" },
      },
      // Kaskad-hoppad utrustningsrad.
      {
        rowNumber: 4,
        status: "skipped",
        validationMsgs: [
          {
            field: "execute",
            message: 'Primärraden för interim "I-1" importerades inte — utrustningsraden hoppas över.',
            severity: "warning",
            code: "equipment_skipped_missing_primary",
          },
        ],
        objectId: null,
        objectName: null,
        rawData: { "0": "Hjullastare" },
      },
      // Vanlig importerad rad utan execute-notering.
      { rowNumber: 5, status: "imported", validationMsgs: [], objectId: "obj-c", objectName: "Vanlig", rawData: { "0": "Vanlig" } },
    ];

    const { becameRootRows, skippedEquipmentRows } = classifyExecuteRowNotes(rows, "0");
    expect(becameRootRows).toEqual([
      expect.objectContaining({ rowNumber: 2, objectId: "obj-a", name: "Butik Nord" }),
    ]);
    expect(skippedEquipmentRows).toEqual([
      expect.objectContaining({ rowNumber: 4, name: "Hjullastare" }),
    ]);
  });

  it("fallback på meddelandesemantik för äldre sessioner utan kod", () => {
    const rows = [
      {
        rowNumber: 1,
        status: "imported",
        validationMsgs: [
          { field: "execute", message: "Föräldern kunde inte hittas (…) — objektet importerades som topphierarki (rot).", severity: "warning" },
        ],
        objectId: "obj-x",
        objectName: null,
        rawData: { "2": "Fastighet A" },
      },
      // Gammal update-rad (behållen placering) utan kod — matchar inte rot-frasen.
      {
        rowNumber: 2,
        status: "imported",
        validationMsgs: [
          { field: "execute", message: "Föräldern kunde inte hittas (…) — objektets befintliga placering behålls.", severity: "warning" },
        ],
        objectId: "obj-y",
        objectName: "Y",
        rawData: {},
      },
      {
        rowNumber: 3,
        status: "skipped",
        validationMsgs: [
          { field: "execute", message: 'Primärraden för interim "I-9" importerades inte — utrustningsraden hoppas över.', severity: "warning" },
        ],
        objectId: null,
        objectName: null,
        rawData: { "2": "Pump" },
      },
      // Användar-skippad rad utan execute-notering listas inte.
      { rowNumber: 4, status: "skipped", validationMsgs: null, objectId: null, objectName: null, rawData: {} },
    ];

    const { becameRootRows, skippedEquipmentRows } = classifyExecuteRowNotes(rows, "2");
    expect(becameRootRows.map((r) => r.rowNumber)).toEqual([1]);
    expect(becameRootRows[0].name).toBe("Fastighet A"); // rawData-fallback när objektnamn saknas
    expect(skippedEquipmentRows.map((r) => r.rowNumber)).toEqual([3]);
  });

  it("returnerar null-namn när ingen namn-kolumn är mappad", () => {
    const { skippedEquipmentRows } = classifyExecuteRowNotes(
      [
        {
          rowNumber: 7,
          status: "skipped",
          validationMsgs: [
            { field: "execute", message: "… utrustningsraden hoppas över.", severity: "warning", code: "equipment_skipped_missing_primary" },
          ],
          objectId: null,
          objectName: null,
          rawData: { "0": "Namn" },
        },
      ],
      null,
    );
    expect(skippedEquipmentRows[0].name).toBeNull();
  });
});
