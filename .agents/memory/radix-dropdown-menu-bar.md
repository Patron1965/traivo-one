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

## Tom dropdown ≠ modal-problemet
Samma symptom (AI-menyn "verkar tom" / kräver extra klick) kan ha en HELT ANNAN orsak: en navgrupp vars rollkontroll (`canAccessMenu`) släpper igenom gruppen men vars alla menyposter filtreras bort av modul-gating (`isNavItemEnabled`) eller `adminOnly`/`platformOwnerOnly`. Då renderas trigger-knappen ändå men dropdownen öppnar en tom ruta.

**Regel:** Rendera ALDRIG en navgrupp/dropdown vars filtrerade `items`-lista är tom. Kombinera alltid rollkontroll med `items.length > 0`. MobileNav och AppSidebar gjorde redan detta; TopNav saknade guarden tills detta upptäcktes. När du felsöker "tom meny" — kontrollera FÖRST om `modal={false}` redan finns; gör den det är orsaken sannolikt tom item-lista, inte overlay-problemet.
