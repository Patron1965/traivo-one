---
name: Article status — aktiv vs active
description: Artikelns status har två konventioner (svensk "aktiv" från formuläret vs legacy/DB-default "active"); filter måste acceptera båda.
---

# Artikelstatus: "aktiv" vs "active"

`ArticleFormPage` sparar **svensk** statuslivscykel: `aktiv → utgående → utgått`
(legacy `active`/`inactive` stöds fortfarande, och DB-kolumnens **default är `active`**).
Det betyder att artiklar skapade/redigerade via formuläret oftast har `status = "aktiv"`,
medan seed/demo-data och äldre rader har `status = "active"`.

**Regeln:** filtrera ALDRIG aktiva artiklar med `status === "active"` (eller `!== "active"`).
Det exkluderar tyst alla formulär-skapade artiklar. Använd istället
`isActiveArticleStatus(status)` (`server/article-quantity.ts`), som godtar både
`"active"` och `"aktiv"` (case/trim-tolerant) men **inte** `utgående`/`utgått`.

**Why:** Mobil-metadata (Visa/Lämna) och redigerbart antal i Traivo Go gatear på
artikelstatus. Med `=== "active"` blev hela funktionen icke-fungerande för
formulär-artiklar ("aktiv") — de renderade inte, child-metadata kunde inte auktoriseras,
och antalet gick inte att ändra. Buggen är osynlig i demo (seed använder "active") och
fångas inte av tsc.

**How to apply:** När du skriver ny logik som behöver "är artikeln aktiv?", importera
och använd `isActiveArticleStatus`. Det finns redan flera pre-existing `status === "active"`
artikelfilter i `server/routes/mobile/misc.ts` (t.ex. legacy info-carrier-listan ~716,
dependencyArticles ~788) som har samma latenta brist — migrera dem till helpern om/när du
rör dem, men det var utanför scope för den första fixen.
