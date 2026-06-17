---
name: Metadata-lämnare publik form (Metadata Editor)
description: E2E-quirks för publika metadata-lämnar-formuläret (3 typer) + testharness-fallgrop för GPS-geolocation.
---

# Metadata-lämnare (Metadata Editor) — publik form

Tre editor-typer: `object_specific` (objekt valt vid länk-mint), `gps` (visar närliggande
objekt via geolocation), `object_creating` (skapar nytt objekt).

## GPS-formuläret hänger på "Söker objekt nära din position..."
`MetadataEditorPublicPage` sätter `nearbyLoading=true` direkt i mount-effekten och rensar
det ENBART när `navigator.geolocation.getCurrentPosition` callbackar (success ELLER error).
Om varken success eller error fyrar (t.ex. permission i "prompt"-läge i Playwright) blir
sidan stuck på `status-nearby-loading` för alltid.

**How to apply (E2E-test):** skapa browser-context MED `geolocation:{latitude,longitude}`
OCH `permissions:['geolocation']` satt UPP-FRONT (i context-options eller via
grantPermissions+setGeolocation) FÖRE navigering till `/metadata-form/<token>`. Backend
`GET /api/public/metadata-editor/nearby?t=&lat=&lng=` funkar fristående (verifiera med curl).

## Approve vs reject metadata-skrivning
`approveSubmission` skriver varje värde till `metadata_varden` via `createMetadata`
(slår upp `metadata_katalog` på NAMN; nya fält-labels auto-provisioneras som katalogfält).
`rejectSubmission` skriver INGEN metadata. Foto lagras som JSON `{photos:[...]}`.

## Token
Publik länk = HMAC-signerad token (`signMetadataEditorToken`, prefix `mde:`,
`dynamic-qr-token.ts`), payload `tenant:editor[:object]` base64url. Verifieras server-side;
inget rå-id från klient. "Länken är ogiltig" i UI = verify returnerade null ELLER endpoint
500:ade (kolla serverloggar — ett 500 ser ut som ogiltig länk i frontend).
