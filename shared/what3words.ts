/**
 * Delad What3words-validering (Task #1118).
 *
 * What3words-adresser är tre ord separerade med punkt, t.ex. `filled.count.soap`.
 * Adressen kan valfritt prefixas med `///`. Orden kan innehålla unicode-bokstäver
 * (och kombinerande tecken/apostrof för vissa språk), men aldrig siffror, blanksteg
 * eller andra symboler.
 *
 * Samma regel används på både klient och server så att inline-validering i UI:t
 * exakt matchar serverns avvisning.
 */

// Tre ord separerade med punkt, med valfritt ledande `///`-prefix. Varje ord är
// ett eller flera tecken som inte är blanksteg, siffror eller vanlig
// skiljetecken/symbol — vilket släpper igenom unicode-bokstäver (åäö m.m.) utan
// att behöva `u`-flaggan, men avvisar adresser med t.ex. `!`, `,` eller `@`.
// Tecken-klassen följer What3words egen ordregel (exkluderar siffror + symboler).
const W3W_WORD = "[^\\s\\d`~!@#$%^&*()+\\-_=[{\\]}\\\\|'<,.>?/\";:]+";
export const WHAT3WORDS_REGEX = new RegExp(
  `^(?:///)?${W3W_WORD}\\.${W3W_WORD}\\.${W3W_WORD}$`,
);

/** Tar bort ev. ledande `///`-prefix, trimmar och normaliserar till gemener. */
export function normalizeWhat3words(raw: string): string {
  return raw.trim().replace(/^\/+/, "").toLowerCase();
}

/** True om strängen har giltigt three-word-format (innehållet verifieras ej mot API:t). */
export function isValidWhat3words(raw: string): boolean {
  return WHAT3WORDS_REGEX.test(raw.trim());
}

/** Svenskt felmeddelande för ogiltigt format — delas av server och klient. */
export const WHAT3WORDS_FORMAT_ERROR =
  "Ogiltig What3words-adress. Ange tre ord separerade med punkt, t.ex. filled.count.soap";
