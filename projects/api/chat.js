function stripPossibleCodeFences(text) {
  const t = String(text || "").trim();
  if (!t.startsWith("```")) return t;
  return t.replace(/^```[a-zA-Z]*\s*/i, "").replace(/```$/i, "").trim();
}

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const userInput = String(req.body?.userInput || "").trim();
    if (!userInput) {
      return res.status(400).json({ error: "Missing userInput" });
    }

    const apiKey = String(process.env.DEEPSEEK_API_KEY || "").trim();
    if (!apiKey) {
      return res.status(500).json({ error: "Missing DEEPSEEK_API_KEY" });
    }

    const systemPrompt =
      "你是一个金融数据架构师。请将用户的自然语言选股请求转换为标准JSON。必须且只能返回包含 factors(对象) 和 sql(字符串) 两个字段的JSON，不要任何Markdown标记。";

    const upstream = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        temperature: 0.1,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userInput },
        ],
      }),
    });

    const upstreamJson = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: "DeepSeek upstream error",
        detail: upstreamJson || null,
      });
    }

    const content = upstreamJson?.choices?.[0]?.message?.content;
    const cleaned = stripPossibleCodeFences(content);

    try {
      const parsed = JSON.parse(cleaned);
      return res.status(200).json(parsed);
    } catch {
      // Fallback: return raw string wrapped as JSON
      return res.status(200).json({ raw: cleaned });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: "Internal Server Error", detail: message });
  }
}
