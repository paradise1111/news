
import { AppConfig, DigestData, ModelOption } from "../types";
import { DEFAULT_MODELS } from "../constants";

// Helper: Normalize Base URL
const normalizeBaseUrl = (url: string): string => {
  let cleaned = url.trim().replace(/\/+$/, '');
  if (!cleaned.endsWith('/v1')) {
      return `${cleaned}/v1`;
  }
  return cleaned;
};

// Advanced JSON Extractor that handles nested objects and preamble text
const extractJson = (str: string): any => {
    // 1. Try direct parse
    try {
        return JSON.parse(str.trim());
    } catch (e) {}

    // 2. Remove markdown code blocks
    let cleaned = str.replace(/```json/g, '').replace(/```/g, '').trim();
    try {
        return JSON.parse(cleaned);
    } catch (e) {}

    // 3. Find the largest JSON-like structure {}
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const potentialJson = cleaned.substring(firstBrace, lastBrace + 1);
        try {
            return JSON.parse(potentialJson);
        } catch (e) {
            // 4. Extreme fallback: Replace newlines and try to fix common trailing comma errors
            const fixedJson = potentialJson
                .replace(/,\s*([\]}])/g, '$1'); // Remove trailing commas
            try {
                return JSON.parse(fixedJson);
            } catch (e2) {}
        }
    }
    
    throw new Error("Could not parse JSON from AI response.");
};

const openAIFetch = async (
  baseUrl: string,
  apiKey: string,
  endpoint: string,
  body?: any,
  method: string = 'POST'
) => {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  const targetUrl = `${normalizedBase}${endpoint}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180000); 

  try {
    const response = await fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        targetUrl,
        method,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body 
      }),
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
       const errorText = await response.text();
       throw new Error(`Proxy Error (${response.status}): ${errorText}`);
    }

    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('text/event-stream')) {
        const reader = response.body?.getReader();
        if (!reader) throw new Error("Stream not supported");
        
        const decoder = new TextDecoder();
        let buffer = '';
        let fullContent = '';
        let hasError = false;
        let errorMessage = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith(':')) continue;

                if (trimmed.startsWith('event: error')) {
                    hasError = true;
                } else if (trimmed.startsWith('data: ')) {
                    const dataContent = trimmed.substring(6);
                    if (dataContent === '[DONE]') continue;
                    
                    if (hasError) {
                        errorMessage = dataContent;
                    } else {
                        try {
                            const parsed = JSON.parse(dataContent);
                            // Handle both streaming delta and non-streaming fallback from proxy
                            if (parsed.choices?.[0]?.delta?.content) {
                                fullContent += parsed.choices[0].delta.content;
                            } else if (typeof parsed === 'string') {
                                fullContent = parsed; // Non-streaming fallback
                            } else if (parsed.choices?.[0]?.message?.content) {
                                fullContent = parsed.choices[0].message.content;
                            }
                        } catch (e) {}
                    }
                }
            }
        }

        if (hasError) throw new Error(errorMessage || "Stream error");
        return extractJson(fullContent);
    } 
    
    const directJson = await response.json();
    return directJson;

  } catch (error: any) {
      clearTimeout(timeoutId);
      throw error;
  }
};

export const checkModelAvailability = async (apiKey: string, baseUrl: string, modelId: string) => {
  const start = Date.now();
  try {
    await openAIFetch(baseUrl, apiKey, '/chat/completions', {
      model: modelId,
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 5,
      stream: false
    });
    return { available: true, latency: Date.now() - start };
  } catch (error: any) {
    return { available: false, error: error.message };
  }
};

export const verifyAndFetchModels = async (apiKey: string, baseUrl: string): Promise<ModelOption[]> => {
  try {
    const data = await openAIFetch(baseUrl, apiKey, '/models', undefined, 'GET');
    if (data && Array.isArray(data.data)) {
        return data.data.map((m: any) => ({ id: m.id, name: m.id, status: 'unknown' }));
    }
    return DEFAULT_MODELS.map(m => ({ ...m, status: 'unknown' } as ModelOption));
  } catch (e: any) {
    return DEFAULT_MODELS.map(m => ({ ...m, status: 'unknown' } as ModelOption));
  }
};

export const generateDailyDigest = async (config: AppConfig, onLog: (msg: string) => void): Promise<DigestData> => {
  onLog(`正在启动 (模型: ${config.model})...`);

  const todayStr = new Date().toISOString().split('T')[0];
  const prompt = `
    You are a professional News Editor.
    Today's Date: ${todayStr}.
    
    ### REQUIREMENTS
    1. **QUANTITY**: Output EXACTLY 6 to 10 items for "social" AND 6 to 10 items for "health". Total 12-20 items.
    2. **TOPICS**: Only high-impact, trending, or breaking news from the last 24-48 hours.
    3. **LINKS (CRITICAL)**: 
       - Every link MUST be a direct, working URL to a news article.
       - NO 404s. Do not invent slugs.
       - If you cannot verify a direct URL, you MUST use a Google Search URL: "https://www.google.com/search?q=[Topic+Keywords]" as the source_url.
    4. **SUMMARIES**: 
       - summary_cn: Professional, engaging Chinese summary (approx 80-100 chars).
       - summary_en: One concise English sentence.
    
    ### FORMAT (JSON ONLY)
    {
      "social": [ { "title": "...", "summary_en": "...", "summary_cn": "...", "source_url": "...", "source_name": "...", "ai_score": 90, "ai_score_reason": "...", "tags": ["..."] } ],
      "health": [ { "title": "...", "xhs_titles": ["标题1", "标题2", "标题3"], ... } ]
    }
  `;

  const payload: any = {
    model: config.model,
    messages: [
        { role: "system", content: "You strictly output JSON. You prioritize news from reliable sources. You ensure URLs are reachable or use Google Search fallback to avoid 404." },
        { role: "user", content: prompt }
    ],
    stream: true,
    max_tokens: 4000,
    tools: config.model.includes('deepseek') ? undefined : [{ googleSearch: {} }],
    response_format: { type: "json_object" }
  };

  try {
    onLog("正在搜索并生成日报内容 (严控 6-10 条)...");
    const data = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', payload);
    onLog("数据生成成功，开始校验格式...");
    
    if (!data.social || !data.health) {
        throw new Error("Received partial data from AI.");
    }

    return data as DigestData;
  } catch (error: any) {
    onLog(`错误: ${error.message}`);
    throw error;
  }
};
