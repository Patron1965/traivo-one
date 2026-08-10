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

## Syskon-Popovers i formulär: harmonisera modal + blockera fokus-läckage
När två Popovers ligger som syskon-fält (t.ex. `AddressSearch` direkt följt av `CustomerCombobox` i "Skapa nytt objekt"-dialogen) räcker det inte att bara matcha `modal`. En `modal`-Popover bredvid en icke-modal triggar fokus-/click-konflikter som öppnar fel meny av sig själv. Två krav: (1) sätt SAMMA `modal`-värde på båda (här `modal={false}`); (2) på den Popover vars innehåll är en sök/Command-lista, sätt `onCloseAutoFocus={(e) => e.preventDefault()}` — annars flyttar Radix fokus vid stängning (efter val) till nästa fokuserbara kontroll (kund-knappen direkt under), som då öppnas. `onOpenAutoFocus` prevent räcker INTE — det är *close*-fokusrestaureringen som läcker.

**Generell regel (alla sök-comboboxes):** Varje Popover vars innehåll är ett sök-/Command-fält och som stänger-på-val måste ha `onCloseAutoFocus`-prevent — annars läcker close-fokus till nästa fokuserbara trigger. Det gäller även när nästa trigger ligger i ett separat barn (t.ex. `ObjectParentCombobox` följt av `MetadataFieldBuilder`-popovers) och när samma combobox staplas en-per-rad i en `.map` (ImportPage kund-mappning → fokus hoppar till nästa rads trigger). Standardiserade fält: `AddressSearch`, `CustomerCombobox`/`CustomerMultiCombobox`, `ObjectCombobox`/`ClusterCombobox` (`AnnualPlanningCombos`), `ObjectParentCombobox` samt ImportPages lokala `CustomerCombobox`. Harmonisera även `modal`: `ObjectCombobox`/`ClusterCombobox` sattes till `modal={false}` så de matchar syskonet `CustomerCombobox` i "Nytt årsmål"-dialogen.

## DropdownMenu-item som öppnar Dialog/AlertDialog: modal={false} + uppskjuten öppning
En modal DropdownMenu vars item öppnar en modal Dialog/AlertDialog ger "frusen knapp": menyns scroll-/fokuslås krockar med dialogens, och när dialogen stängs lämnas ett kvarhängande lås som sväljer alla klick (Snabborderns "+ Lägg till" var första fallet).

**Vakt:** `npm run lint:frozen-dropdown` (workflow `frozen-dropdown`, `scripts/lint-frozen-dropdown-dialog.ts`) flaggar `<DropdownMenu>` utan `modal={false}` vars content matchar `set*Open(true)`/`set*Target(`/`set*Dialog`; falskt positivt undantas med kommentaren `lint-allow-modal-dropdown` på raden före.

**Regel:** varje `DropdownMenu` vars items öppnar en Dialog/AlertDialog/Sheet ska ha (1) `modal={false}` på `<DropdownMenu>`, och (2) dialogöppningen via `onSelect={() => setTimeout(() => setXOpen(true), 0)}` — så att menyn hinner stänga klart innan dialogen tar över fokus/lås. Synkron state (t.ex. `setItemToDelete(...)`) kan sättas direkt; bara själva open-flaggan skjuts upp. Items som bara navigerar/kör en åtgärd utan dialog behöver inget av detta.

## Command-combobox inuti en redan-modal Dialog: klick registreras inte alls
Ett Popover+Command (sök-combobox) som ligger INUTI en `<Dialog>` (t.ex. "Lägg till metadata"-dialogen, `ObjectMetadataForm.tsx`) kan få ett värre symptom än fokusläckage: klick på ett `CommandItem` gör ingenting alls — dropdownen förblir öppen, inget väljs. Orsak: utan `modal={false}` på Popovern konkurrerar dess fokus-/pointer-hantering med den yttre Dialogens fokusfälla, så pointerdown-eventet "sväljs" innan cmdk:s `onSelect` hinner triggas.

**Regel:** Alla Popover+Command-comboboxes nästlade i en `Dialog` MÅSTE ha både `modal={false}` på `<Popover>` och `onCloseAutoFocus={(e) => e.preventDefault()}` på `<PopoverContent>` — samma par som redan standardiserats i `ObjectParentCombobox`. Saknas paret helt (ej bara `onCloseAutoFocus`) kan hela valet sluta fungera, inte bara fokus hoppa fel.
