"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiRoutes = void 0;
const express_1 = require("express");
const openai_1 = __importStar(require("openai"));
const openai = new openai_1.default({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});
const router = (0, express_1.Router)();
exports.aiRoutes = router;
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
            }
            else {
                const { currentOrder, allOrders, driverName } = context;
                if (driverName)
                    contextInfo += `Förarens namn: ${driverName}\n`;
                if (currentOrder)
                    contextInfo += `Aktuell order: ${JSON.stringify(currentOrder)}\n`;
                if (allOrders && allOrders.length > 0)
                    contextInfo += `Alla dagens ordrar: ${JSON.stringify(allOrders)}\n`;
            }
        }
        const systemPrompt = `Du är "Unicorn Assist", en AI-assistent för fältservicetekniker inom avfallshantering och logistik.

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
    }
    catch (error) {
        console.error('AI chat error:', error);
        res.status(500).json({ error: 'Kunde inte generera svar från AI' });
    }
});
router.post('/transcribe', async (req, res) => {
    try {
        const { audio } = req.body;
        if (!audio) {
            return res.status(400).json({ error: 'Ljuddata krävs' });
        }
        const audioBuffer = Buffer.from(audio, 'base64');
        const file = await (0, openai_1.toFile)(audioBuffer, 'audio.webm');
        const transcription = await openai.audio.transcriptions.create({
            file,
            model: 'gpt-4o-mini-transcribe',
        });
        res.json({ text: transcription.text });
    }
    catch (error) {
        console.error('Transcription error:', error);
        res.status(500).json({ error: 'Kunde inte transkribera ljudet' });
    }
});
router.post('/analyze-image', async (req, res) => {
    try {
        const { image, context } = req.body;
        if (!image) {
            return res.status(400).json({ error: 'Bilddata krävs' });
        }
        const systemPrompt = `Du är en AI som analyserar foton från fältservicearbete. Beskriv vad du ser, identifiera problem eller avvikelser, och föreslå en kategori och beskrivning för avvikelserapporteringen.

Kategorier: broken_container, wrong_address, blocked_access, contamination, overfilled, missing_container, other

Svara alltid på svenska.

Svara i följande JSON-format:
{
  "description": "En beskrivning av vad du ser på bilden",
  "suggestedCategory": "en_av_kategorierna_ovan",
  "suggestedDescription": "En föreslagen beskrivning för avvikelserapporten"
}${context ? `\n\nYtterligare kontext: ${context}` : ''}`;
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
                });
            }
            else {
                res.json({
                    description: content,
                    suggestedCategory: 'other',
                    suggestedDescription: content,
                });
            }
        }
        catch {
            res.json({
                description: content,
                suggestedCategory: 'other',
                suggestedDescription: content,
            });
        }
    }
    catch (error) {
        console.error('Image analysis error:', error);
        res.status(500).json({ error: 'Kunde inte analysera bilden' });
    }
});
