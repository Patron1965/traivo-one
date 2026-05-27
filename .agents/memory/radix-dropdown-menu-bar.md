---
name: Radix DropdownMenu i menyrad — använd modal={false}
description: Bredvid-varandra-dropdowns kräver modal={false} annars kräver byte två klick.
---

När flera Radix `DropdownMenu`-komponenter ligger som syskon i en menyrad (TopNav, toolbar, etc.) måste varje `<DropdownMenu>` sättas till `modal={false}`. Default är `modal={true}` vilket renderar en osynlig overlay som "sväljer" det första klicket på nästa triggerknapp — den öppna menyn stängs, men nästa öppnas inte, och dropdownen verkar "tom" eller obrukbar tills man klickar igen.

**Why:** Användare rapporterade att t.ex. AI-dropdownen inte visade något när man klickade på den direkt efter Grunddata-dropdownen. Symptomet är ett klick som "försvinner".

**How to apply:**
- I menyrader / toolbars där flera `DropdownMenu` är syskon: sätt `modal={false}` på alla.
- Påverkar inte enskilda fristående dropdowns (kontextmenyer, row-actions) — där är default OK.
- Gäller även Radix `Dialog`, `Popover`, `Sheet` när de förekommer parvis bredvid varandra som triggers.
