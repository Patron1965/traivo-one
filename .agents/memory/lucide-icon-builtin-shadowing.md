---
name: Lucide-ikoner som skuggar inbyggda JS-objekt
description: Ikonimporter som `Map` från lucide-react skuggar globala konstruktorer och kraschar i runtime; importera alltid med alias.
---

Regel: importera aldrig lucide-ikoner vars namn krockar med JS-inbyggda (`Map`, `Infinity`, `Text` m.fl.) utan alias — använd `Map as MapIcon`.

**Why:** `import { Map } from "lucide-react"` skuggade global `Map` i HierarchyTable; `new Map()` försökte konstruera React-komponenten → prod-krasch "ms is not a constructor" (minifierat namn). tsc flaggade det (TS7009 på `new Map<...>()`) men felet drunknade i det stabila tsc-baseline-bruset — samma fälla som prop-contract-städningen.

**How to apply:** vid nya lucide-importer, alias:a kollisionsnamn; vid TS7009/TS2558 på `new Map/Set/...` i en fil, misstänk ikon-skuggning direkt i stället för att avfärda som baseline-brus.
