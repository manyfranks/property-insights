import OpenAI from "openai";

const openrouter = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY || "",
});

interface LLMSignals {
  signals: string[];
  confidence: number;
}

/**
 * Use an LLM to detect motivation signals that keyword matching misses.
 * Returns additional signals not already caught by the deterministic scorer.
 */
export async function analyzeDescription(description: string): Promise<LLMSignals> {
  if (!process.env.OPENROUTER_API_KEY || !description.trim()) {
    return { signals: [], confidence: 0 };
  }

  try {
    const response = await openrouter.chat.completions.create({
      model: "anthropic/claude-haiku",
      max_tokens: 200,
      messages: [
        {
          role: "system",
          content: `You are a real estate acquisition analyst. Analyze the MLS listing description for seller motivation signals that suggest negotiation leverage. Return ONLY a JSON object with this shape: {"signals": string[], "confidence": number}

Look for signals like:
- Relocation / moving away
- Health/age/life change reasons
- Financial pressure (foreclosure, liens, divorce)
- Property condition issues (as-is, needs work, deferred maintenance)
- Vacant property / unoccupied
- Builder/developer trying to move inventory
- Unusual urgency language not covered by standard keywords

Do NOT include signals that are obvious from keywords like "estate sale", "price reduced", "motivated seller", "must sell" — those are already detected separately. Only flag signals that require reading comprehension.

Confidence: 0.0 to 1.0 based on how clearly the description signals motivation.
If the description is generic marketing copy with no motivation signals, return {"signals": [], "confidence": 0}.`,
        },
        {
          role: "user",
          content: description,
        },
      ],
    });

    const text = response.choices[0]?.message?.content?.trim() || "";
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { signals: [], confidence: 0 };

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      signals: Array.isArray(parsed.signals) ? parsed.signals : [],
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
    };
  } catch {
    return { signals: [], confidence: 0 };
  }
}

/**
 * Generate a plain-English offer narrative explaining the recommended price.
 */
export async function generateOfferNarrative(context: {
  address: string;
  listPrice: number;
  assessedValue: number;
  finalOffer: number;
  savings: number;
  percentOfList: number;
  domTag: string;
  dom: number;
  anchorTag: string;
  signalTags: string[];
  signals: string[];
}): Promise<string> {
  if (!process.env.OPENROUTER_API_KEY) {
    return "";
  }

  try {
    const response = await openrouter.chat.completions.create({
      model: "anthropic/claude-sonnet-4-20250514",
      max_tokens: 250,
      messages: [
        {
          role: "system",
          content: `You are a real estate acquisition advisor writing for an investor. Generate a 2-3 sentence plain-English explanation of why a specific offer price is recommended. Be direct, confident, and data-driven. Reference the key factors (assessment gap, days on market, motivation signals) without being overly technical. Write as if advising a client, not explaining a model.`,
        },
        {
          role: "user",
          content: `Property: ${context.address}
List price: $${context.listPrice.toLocaleString()}
BC Assessed value: $${context.assessedValue.toLocaleString()}
Our recommended offer: $${context.finalOffer.toLocaleString()} (${(context.percentOfList * 100).toFixed(1)}% of list)
Potential savings: $${context.savings.toLocaleString()}
Days on market: ${context.dom} (${context.domTag})
Assessment classification: ${context.anchorTag}
Offer adjustments applied: ${context.signalTags.join(", ") || "none"}
Detected signals: ${context.signals.join(", ") || "none"}

Write 2-3 sentences explaining why this offer makes sense.`,
        },
      ],
    });

    return response.choices[0]?.message?.content?.trim() || "";
  } catch {
    return "";
  }
}
