import { withRetry } from "../ai-budget-service";

export interface StructuredIssue {
  category: string;
  title: string;
  description: string;
  severityLevel: string;
  priority: string;
  objectTypeGuess: string | null;
  suggestedAction: string | null;
}

export interface ParseIssueReportOptions {
  text: string;
  objectName?: string | null;
  objectType?: string | null;
  model: string;
  tenantId: string;
}

/**
 * Delad AI-tolkning av fritext-felanmälan → strukturerade fält.
 * Återanvänds av den autentiserade endpointen (/api/ai/parse-issue-report)
 * och den token-gatade publika endpointen (/api/public/parse-issue-report)
 * så att fält förifylls likadant oavsett ingång. Innehåller ingen budget-
 * eller auth-logik — det ansvarar anroparen för.
 */
export async function parseIssueReportAI(opts: ParseIssueReportOptions): Promise<StructuredIssue> {
  const { text, objectName, objectType, model, tenantId } = opts;

  const { DEVIATION_CATEGORIES, DEVIATION_CATEGORY_LABELS, SEVERITY_LEVELS } = await import("@shared/schema");
  const categoryList = DEVIATION_CATEGORIES.map(
    (c) => `${c} (${DEVIATION_CATEGORY_LABELS[c]})`
  ).join(", ");

  const OpenAI = (await import("openai")).default;
  const openai = new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });

  const systemPrompt = `Du är en assistent som tolkar felanmälningar för ett fältservice-/avfallshanteringssystem.
Användaren skriver en felanmälan med egna ord på svenska. Din uppgift är att extrahera strukturerad information.

Svara ENDAST med ett JSON-objekt med följande fält:
- "category": EXAKT en av dessa koder: ${categoryList}. Välj den som passar bäst, annars "other".
- "title": en kort, tydlig sammanfattning på svenska (max 80 tecken).
- "description": en rensad, fullständig beskrivning på svenska baserad på texten.
- "severityLevel": en av ${SEVERITY_LEVELS.join(", ")} (low=kan vänta, medium=bör åtgärdas snart, high=åtgärdas inom kort, critical=omedelbar fara).
- "priority": en av low, normal, high, urgent.
- "objectTypeGuess": en kort gissning av objekttyp på svenska (t.ex. "Matavfallskärl", "Belysning", "Container"), eller null.
- "suggestedAction": ett kort förslag på åtgärd på svenska, eller null.

Var konservativ med severity/priority — sätt bara high/critical vid tydlig fara eller akut driftstörning.`;

  const userContent = `Felanmälan: "${text.trim()}"` +
    (objectName ? `\nKänt objekt: ${objectName}` : "") +
    (objectType ? `\nObjekttyp: ${objectType}` : "");

  const { trackOpenAIResponse } = await import("../api-usage-tracker");

  const response = await withRetry(
    () => openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      response_format: { type: "json_object" },
      max_tokens: 400,
      temperature: 0.2,
    }),
    { label: "parse-issue-report" }
  );

  trackOpenAIResponse(response, tenantId);

  const raw = response.choices[0]?.message?.content || "{}";
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("AI-svaret kunde inte tolkas. Försök igen.");
  }

  const validCategories = DEVIATION_CATEGORIES as readonly string[];
  const validSeverities = SEVERITY_LEVELS as readonly string[];
  const validPriorities = ["low", "normal", "high", "urgent"];

  const category = validCategories.includes(String(parsed.category)) ? String(parsed.category) : "other";
  const severityLevel = validSeverities.includes(String(parsed.severityLevel)) ? String(parsed.severityLevel) : "medium";
  const priority = validPriorities.includes(String(parsed.priority)) ? String(parsed.priority) : "normal";

  return {
    category,
    title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim().slice(0, 120) : text.trim().slice(0, 80),
    description: typeof parsed.description === "string" ? parsed.description.trim() : text.trim(),
    severityLevel,
    priority,
    objectTypeGuess: typeof parsed.objectTypeGuess === "string" && parsed.objectTypeGuess.trim() ? parsed.objectTypeGuess.trim() : null,
    suggestedAction: typeof parsed.suggestedAction === "string" && parsed.suggestedAction.trim() ? parsed.suggestedAction.trim() : null,
  };
}
