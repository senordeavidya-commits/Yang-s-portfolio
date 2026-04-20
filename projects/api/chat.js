/**
 * Vercel Serverless Function (Node.js)
 * Route: /api/chat
 *
 * Expects: POST { userInput: string }
 * Uses: process.env.DEEPSEEK_API_KEY
 * Returns: { factors: object, sql: string }
 */

function stripPossibleCodeFences(text) {
  const t = String(text || "").trim();
  if (!t.startsWith("```")) return t;
  return t.replace(/^```[a-zA-Z]*\s*/i, "").replace(/```$/i, "").trim();
}

function safeJsonParse(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: e };
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const apiKey = String(process.env.DEEPSEEK_API_KEY || "").trim();
    if (!apiKey) {
      return res.status(500).json({ error: "Missing DEEPSEEK_API_KEY in environment variables." });
    }

    const body = typeof req.body === "string" ? safeJsonParse(req.body).value : req.body;
    const userInput = String(body?.userInput || "").trim();
    if (!userInput) {
      return res.status(400).json({ error: "Missing userInput" });
    }

    const systemPrompt =
      "你是一个金融数据架构师。请将用户的自然语言选股请求转换为一个标准的 JSON 格式，提取核心选股因子（如行业、市盈率上限、概念等），并生成一条对应的拟真 SQL 语句。返回格式必须严格为包含 factors (JSON 对象) 和 sql (字符串) 的合法 JSON，不带 markdown 标记。";

    const payload = {
      model: "deepseek-chat",
      temperature: 0.1,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userInput },
      ],
    };

    const upstream = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const rawText = await upstream.text();
    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: "DeepSeek upstream error",
        status: upstream.status,
        detail: rawText,
      });
    }

    const upstreamJson = safeJsonParse(rawText);
    if (!upstreamJson.ok) {
      return res.status(500).json({ error: "Invalid upstream JSON", detail: rawText });
    }

    const content = upstreamJson.value?.choices?.[0]?.message?.content;
    if (!content) {
      return res.status(500).json({ error: "Empty content from DeepSeek" });
    }

    const cleaned = stripPossibleCodeFences(content);
    const parsed = safeJsonParse(cleaned);
    if (!parsed.ok) {
      return res.status(500).json({
        error: "Model response is not valid JSON",
        detail: cleaned,
      });
    }

    const { factors, sql } = parsed.value || {};
    if (!factors || typeof factors !== "object" || Array.isArray(factors) || typeof sql !== "string") {
      return res.status(500).json({
        error: "Model JSON shape invalid. Expected { factors: object, sql: string }",
        detail: parsed.value,
      });
    }

    return res.status(200).json({ factors, sql });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: "Internal Server Error", detail: message });
  }
};
