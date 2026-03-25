import { Router, type IRouter } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();

router.post("/scale/read-photo", async (req, res): Promise<void> => {
  const { imageBase64, mimeType = "image/jpeg" } = req.body as {
    imageBase64?: string;
    mimeType?: string;
  };

  if (!imageBase64) {
    res.status(400).json({ error: "imageBase64 é obrigatório" });
    return;
  }

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    max_completion_tokens: 256,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: `data:${mimeType};base64,${imageBase64}`,
              detail: "high",
            },
          },
          {
            type: "text",
            text: `You are a scale reading assistant. Look at this image of a digital scale display and extract the weight value shown.

Rules:
- Return ONLY a JSON object with one field: "grams" (integer number) 
- Convert to grams if needed (e.g. 1.234 kg → 1234)
- If you see "----" or "OL", return {"grams": null, "error": "OVERLOAD"}
- If display shows negative or zero, return {"grams": null, "error": "INVALID"}
- If you cannot read the display clearly, return {"grams": null, "error": "UNREADABLE"}
- Do NOT return any explanation, markdown, or extra text. Only the JSON.

Example valid responses:
{"grams": 1234}
{"grams": null, "error": "OVERLOAD"}`,
          },
        ],
      },
    ],
  });

  const raw = response.choices[0]?.message?.content?.trim() ?? "";

  let parsed: { grams: number | null; error?: string };
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch?.[0] ?? raw);
  } catch {
    res.status(422).json({ error: "Não foi possível interpretar a resposta da IA", raw });
    return;
  }

  res.json(parsed);
});

export default router;
