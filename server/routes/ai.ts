import { Router } from 'express';
import OpenAI, { toFile } from 'openai';

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const router = Router();

router.post('/chat', async (req, res) => {
  try {
    const { message, context } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Meddelande krävs' });
    }

    let contextInfo = '';
    if (context) {
      if (Array.isArray(context)) {
        contextInfo = `Alla dagens ordrar: ${JSON.stringify(context)}\n`;
      } else {
        const { currentOrder, allOrders, driverName } = context;
        if (driverName) contextInfo += `Förarens namn: ${driverName}\n`;
        if (currentOrder) contextInfo += `Aktuell order: ${JSON.stringify(currentOrder)}\n`;
        if (allOrders && allOrders.length > 0) contextInfo += `Alla dagens ordrar: ${JSON.stringify(allOrders)}\n`;
      }
    }

    const systemPrompt = `Du är "Nordnav Assist", en AI-assistent för fältservicetekniker inom avfallshantering och logistik.

Du har tillgång till kontext om aktuella ordrar, adresser, artiklar, kontaktpersoner och annat relevant för dagens arbete.

Regler:
- Svara alltid koncist och tydligt på svenska
- Hjälp med frågor om arbetsuppgifter, navigering, procedurer och rapportering
- Om du får frågor om en order, använd den medföljande kontexten
- Formatera svar tydligt med punktlistor eller numrerade listor vid behov
- Var professionell men vänlig

${contextInfo ? `Aktuell kontext:\n${contextInfo}` : ''}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-5.2',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
    });

    const reply = response.choices[0]?.message?.content || 'Inget svar mottaget.';
    res.json({ response: reply });
  } catch (error: any) {
    console.error('AI chat error:', error);
    res.status(500).json({ error: 'Kunde inte generera svar från AI' });
  }
});

router.post('/chat/stream', async (req, res) => {
  try {
    const { message, context } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Meddelande krävs' });
    }

    let contextInfo = '';
    if (context) {
      if (Array.isArray(context)) {
        contextInfo = `Alla dagens ordrar: ${JSON.stringify(context)}\n`;
      } else {
        const { currentOrder, allOrders, driverName } = context;
        if (driverName) contextInfo += `Förarens namn: ${driverName}\n`;
        if (currentOrder) contextInfo += `Aktuell order: ${JSON.stringify(currentOrder)}\n`;
        if (allOrders && allOrders.length > 0) contextInfo += `Alla dagens ordrar: ${JSON.stringify(allOrders)}\n`;
      }
    }

    const systemPrompt = `Du är "Nordnav Assist", en AI-assistent för fältservicetekniker inom avfallshantering och logistik.

Du har tillgång till kontext om aktuella ordrar, adresser, artiklar, kontaktpersoner och annat relevant för dagens arbete.

Regler:
- Svara alltid koncist och tydligt på svenska
- Hjälp med frågor om arbetsuppgifter, navigering, procedurer och rapportering
- Om du får frågor om en order, använd den medföljande kontexten
- Formatera svar tydligt med punktlistor eller numrerade listor vid behov
- Var professionell men vänlig

${contextInfo ? `Aktuell kontext:\n${contextInfo}` : ''}`;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const stream = await openai.chat.completions.create({
      model: 'gpt-5.2',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error: any) {
    console.error('AI chat stream error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Kunde inte generera svar från AI' });
    } else {
      res.write(`data: ${JSON.stringify({ error: 'Streaming avbröts.' })}\n\n`);
      res.end();
    }
  }
});

const MAX_BASE64_SIZE = 10 * 1024 * 1024;

router.post('/transcribe', async (req, res) => {
  try {
    const { audio } = req.body;
    if (!audio) {
      return res.status(400).json({ error: 'Ljuddata krävs' });
    }
    if (typeof audio !== 'string' || audio.length > MAX_BASE64_SIZE) {
      return res.status(400).json({ error: 'Ljudfilen är för stor (max 10MB)' });
    }

    const audioBuffer = Buffer.from(audio, 'base64');
    const file = await toFile(audioBuffer, 'audio.webm');

    const transcription = await openai.audio.transcriptions.create({
      file,
      model: 'gpt-4o-mini-transcribe',
    });

    res.json({ text: transcription.text });
  } catch (error: any) {
    console.error('Transcription error:', error);
    res.status(500).json({ error: 'Kunde inte transkribera ljudet' });
  }
});

router.post('/voice-command', async (req, res) => {
  try {
    const { audio } = req.body;
    if (!audio) {
      return res.status(400).json({ error: 'Ljuddata krävs' });
    }
    if (typeof audio !== 'string' || audio.length > MAX_BASE64_SIZE) {
      return res.status(400).json({ error: 'Ljudfilen är för stor (max 10MB)' });
    }

    const audioBuffer = Buffer.from(audio, 'base64');
    const file = await toFile(audioBuffer, 'audio.webm');

    const transcription = await openai.audio.transcriptions.create({
      file,
      model: 'gpt-4o-mini-transcribe',
    });

    const spokenText = transcription.text;

    const classifyPrompt = `Du är en röstkommandotolk för en fältservice-app (avfallshantering/logistik). Analysera följande transkriberad text och klassificera vilken åtgärd användaren vill utföra.

Möjliga kommandon:
1. "navigate_orders" - Användaren vill se sina jobb/ordrar/uppdrag (t.ex. "Visa mina jobb", "Visa ordrar", "Mina uppdrag")
2. "start_next" - Användaren vill starta nästa jobb (t.ex. "Starta nästa jobb", "Börja nästa uppdrag", "Starta")
3. "report_deviation" - Användaren vill rapportera en avvikelse (t.ex. "Rapportera avvikelse", "Anmäl problem", "Rapportera fel")
4. "on_site" - Användaren har anlänt till platsen (t.ex. "Jag är på plats", "Framme", "Ankommit")
5. "complete_order" - Användaren vill markera aktuellt uppdrag som klart (t.ex. "Markera klar", "Klar", "Uppdrag klart", "Färdig")
6. "navigate_to" - Användaren vill navigera till nästa uppdragsadress (t.ex. "Navigera dit", "Kör dit", "Visa vägen", "Navigation")
7. "call_customer" - Användaren vill ringa kunden (t.ex. "Ring kunden", "Ring kontakten", "Samtal")
8. "start_break" - Användaren vill ta rast (t.ex. "Ta rast", "Paus", "Rast", "Fikapaus")
9. "navigate_statistics" - Användaren vill se statistik (t.ex. "Visa statistik", "Statistik", "Hur går det")
10. "help" - Användaren vill höra vilka kommandon som finns (t.ex. "Hjälp", "Vad kan jag säga", "Kommandon")
11. "unknown" - Kommandot kunde inte tolkas

Svara ENBART i JSON-format:
{
  "action": "en_av_ovanstående",
  "transcript": "den transkriberade texten",
  "confidence": 0.0-1.0,
  "displayMessage": "kort bekräftelsemeddelande på svenska"
}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-5.2',
      messages: [
        { role: 'system', content: classifyPrompt },
        { role: 'user', content: spokenText },
      ],
    });

    const content = response.choices[0]?.message?.content || '';

    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        res.json({
          action: parsed.action || 'unknown',
          transcript: parsed.transcript || spokenText,
          confidence: parsed.confidence || 0,
          displayMessage: parsed.displayMessage || 'Kommandot kunde inte tolkas.',
        });
      } else {
        res.json({
          action: 'unknown',
          transcript: spokenText,
          confidence: 0,
          displayMessage: 'Kommandot kunde inte tolkas.',
        });
      }
    } catch {
      res.json({
        action: 'unknown',
        transcript: spokenText,
        confidence: 0,
        displayMessage: 'Kommandot kunde inte tolkas.',
      });
    }
  } catch (error: any) {
    console.error('Voice command error:', error);
    res.status(500).json({ error: 'Kunde inte bearbeta röstkommandot' });
  }
});

router.post('/analyze-image', async (req, res) => {
  try {
    const { image, context } = req.body;
    if (!image) {
      return res.status(400).json({ error: 'Bilddata krävs' });
    }
    if (typeof image !== 'string' || image.length > MAX_BASE64_SIZE) {
      return res.status(400).json({ error: 'Bilden är för stor (max 10MB)' });
    }

    const systemPrompt = `Du är en AI som analyserar foton från fältservicearbete. Beskriv vad du ser, identifiera problem eller avvikelser, och föreslå en kategori, allvarlighetsgrad och beskrivning för avvikelserapporteringen.

Kategorier: broken_container, wrong_address, blocked_access, contamination, overfilled, missing_container, damaged_container, wrong_waste, overloaded, other

Allvarlighetsgrader: low, medium, high, critical

Svara alltid på svenska.

Svara i följande JSON-format:
{
  "description": "En beskrivning av vad du ser på bilden",
  "suggestedCategory": "en_av_kategorierna_ovan",
  "suggestedDescription": "En föreslagen beskrivning för avvikelserapporten",
  "suggestedSeverity": "en_av_allvarlighetsgraderna_ovan",
  "confidence": 0.85
}

confidence ska vara ett tal mellan 0 och 1 som anger hur säker du är på din analys.${context ? `\n\nYtterligare kontext: ${context}` : ''}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-5.2',
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Analysera denna bild från fältarbete och identifiera eventuella avvikelser.' },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image}` } },
          ],
        },
      ],
    });

    const content = response.choices[0]?.message?.content || '';

    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        res.json({
          description: parsed.description || content,
          suggestedCategory: parsed.suggestedCategory || 'other',
          suggestedDescription: parsed.suggestedDescription || content,
          suggestedSeverity: parsed.suggestedSeverity || 'medium',
          confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
        });
      } else {
        res.json({
          description: content,
          suggestedCategory: 'other',
          suggestedDescription: content,
          suggestedSeverity: 'medium',
          confidence: 0.5,
        });
      }
    } catch {
      res.json({
        description: content,
        suggestedCategory: 'other',
        suggestedDescription: content,
        suggestedSeverity: 'medium',
        confidence: 0.5,
      });
    }
  } catch (error: any) {
    console.error('Image analysis error:', error);
    res.status(500).json({ error: 'Kunde inte analysera bilden' });
  }
});

export { router as aiRoutes };
