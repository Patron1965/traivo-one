---
name: Objektmall-import diff/preview
description: Hur förhandsvisningens "Ändrad"-diff hålls i synk med vad commit faktiskt skriver
---

# Objektmall-importens fält-diff

Förhandsvisningen (validateAll) bygger en per-fält-diff (changedFields {field,label,from,to})
som måste spegla EXAKT vad commit-steget skriver till DB.

**Regel:** När ett nytt importfält börjar skrivas i commit måste det också läggas till i
diff-beräkningen i validateAll — annars säger förhandsvisningen "oförändrad" medan commit
ändrar värdet (eller tvärtom).

**Why:** "Ändrad"-markeringen och fält-diffen är användarens enda chans att granska före
skarp import. Drift mellan validering och commit = osynliga ändringar.

**How to apply:** De sammansatta notes-fälten byggs via gemensamma helpers
(`buildOrgNotes`/`buildStoreNotes`/`buildContainerNotes` i `server/routes/objektmallImportRoutes.ts`)
som ANROPAS från både validateAll och commitImport. Lägg ny notes-logik där, inte inline.
Kärl-diff jämför `containerCount` + notes; org/butik jämför namn/adress/notes. Tomma
importfält bevaras och räknas aldrig som ändring (matchar commitens partiella patch).
