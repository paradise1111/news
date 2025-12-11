import { AppConfig, DigestData, ModelOption } from "../types";
import { DEFAULT_MODELS } from "../constants";

// Helper: Normalize Base URL to ensure it ends with /v1 convention if missing
const normalizeBaseUrl = (url: string): string => {
  let cleaned = url.trim().replace(/\/+$/, '');
  
  // Many "One API" users forget the /v1 suffix. 
  // If it's not present, we append it to follow OpenAI standards.
  if (!cleaned.endsWith('/v1')) {
      console.log(`[Auto-Fix] Appending /v1 to Base URL: ${cleaned} -> ${cleaned}/v1`);
      return `${cleaned}/v1`;
  }
  return cleaned;
};

// Generic Fetcher for OpenAI-Compatible APIs
const openAIFetch = async (
  baseUrl: string,
  apiKey: string,
  endpoint: string,
  body?: any,
  method: string = 'POST'
) => {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  const url = `${normalizedBase}${endpoint}`;

  console.log(`[API Request] ${method} ${url}`);

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`
  };

  const config: RequestInit = {
    method,
    headers,
  };

  if (body) {
    config.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, config);
    
    if (!response.ok) {
       const errorText = await response.text();
       // Try to parse error JSON if possible
       try {
           const errorJson = JSON.parse(errorText);
           throw new Error(errorJson.error?.message || `HTTP ${response.status}: ${errorText}`);
       } catch (e) {
           throw new Error(`HTTP ${response.status} at ${url}: ${errorText}`);
       }
    }

    return await response.json();
  } catch (error: any) {
      console.error("Fetch Error:", error);
      throw error;
  }
};

// Check if a model is available via Chat Completions
export const checkModelAvailability = async (
  apiKey: string, 
  baseUrl: string, 
  modelId: string
): Promise<{ available: boolean; latency?: number; error?: string }> => {
  const start = Date.now();
  try {
    // Send a minimal request to test connectivity
    await openAIFetch(baseUrl, apiKey, '/chat/completions', {
      model: modelId,
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 5
    });
    return { available: true, latency: Date.now() - start };
  } catch (error: any) {
    return { available: false, error: error.message };
  }
};

// Fetch list of models from /v1/models
export const verifyAndFetchModels = async (apiKey: string, baseUrl: string): Promise<ModelOption[]> => {
  try {
    console.log("Fetching models list from OpenAI-compatible endpoint...");
    const data = await openAIFetch(baseUrl, apiKey, '/models', undefined, 'GET');
    
    // OpenAI format: { object: "list", data: [ { id: "...", ... } ] }
    if (data && Array.isArray(data.data)) {
        const models = data.data.map((m: any) => ({
            id: m.id,
            name: m.id, // OpenAI list endpoint usually just gives IDs
            status: 'unknown'
        }));
        console.log(`Fetched ${models.length} models.`);
        return models.length > 0 ? models : DEFAULT_MODELS.map(m => ({ ...m, status: 'unknown' } as ModelOption));
    }
    
    console.warn("Model list format unexpected:", data);
    return DEFAULT_MODELS.map(m => ({ ...m, status: 'unknown' } as ModelOption));

  } catch (e: any) {
    console.warn("Failed to fetch models list, using defaults.", e.message);
    return DEFAULT_MODELS.map(m => ({ ...m, status: 'unknown' } as ModelOption));
  }
};

export const generateDailyDigest = async (
  config: AppConfig, 
  onLog: (msg: string) => void
): Promise<DigestData> => {
  onLog(`正在初始化 (API 模式: OpenAI 兼容, 模型: ${config.model})...`);

  const prompt = `
    You are an automated Daily Information Digest agent.
    
    ### Task 1: Social Media & Trends (The "Pulse")
    - **Goal**: Identify the TOP 10 trending topics/news today.
    - **Filter**: Ignore minor celebrity gossip. Focus on tech news, major cultural memes, or significant global discussions.
    - **Quantity**: Provide EXACTLY 10 distinct items.

    ### Task 2: Health & Science (The "Breakthroughs")
    - **Goal**: Find the TOP 10 high-impact medical or health news.
    - **Source Check**: Prioritize reputable journals (Nature, Lancet) or major news outlets.
    - **Quantity**: Provide EXACTLY 10 distinct items.

    ### Output Requirements (CRITICAL)
    1. **Depth**: Each English summary must be substantial (approx 60-80 words). Explain context, impact, and why it matters.
    2. **Translation**: Provide a fluent, professional Chinese translation of that summary.
    3. **Format**: Return the result STRICTLY as a JSON object. No Markdown code blocks if possible, just raw JSON.

    The JSON structure must be:
    {
      "social": [
        { "title": "...", "summary_en": "...", "summary_cn": "...", "source_url": "http://...", "source_name": "..." },
      ],
      "health": [
      ]
    }
  `;

  // Construct OpenAI-style payload
  const payload: any = {
    model: config.model,
    messages: [
      { 
          role: "system", 
          content: "You are a professional news analyst. Output valid JSON only." 
      },
      { 
          role: "user", 
          content: prompt 
      }
    ],
    // Some providers support JSON mode to guarantee valid JSON
    response_format: { type: "json_object" }
  };

  try {
    let responseData;
    
    // First attempt with JSON mode
    try {
        onLog("发送请求中 (尝试启用 JSON 模式)...");
        responseData = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', payload);
    } catch(err: any) {
        // If the provider doesn't support response_format (400 Bad Request), retry without it
        if (err.message.includes("response_format") || err.message.includes("400") || err.message.includes("not supported")) {
            onLog("当前模型/平台不支持 strict JSON 模式，正在降级重试...");
            delete payload.response_format;
            responseData = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', payload);
        } else {
            throw err;
        }
    }

    const content = responseData.choices?.[0]?.message?.content;
    
    if (!content) {
        throw new Error("API 返回成功但没有内容 (content is empty)");
    }

    onLog("接收到数据，正在解析...");

    // JSON Parsing Logic
    let text = content.trim();
    // Remove Markdown code blocks if present
    if (text.includes("```json")) {
        text = text.replace(/```json/g, "").replace(/```/g, "");
    } else if (text.includes("```")) {
        text = text.replace(/```/g, "");
    }
    
    let data: DigestData;
    try {
        data = JSON.parse(text);
    } catch (parseError) {
        onLog("JSON 解析初步失败，尝试正则提取...");
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            data = JSON.parse(jsonMatch[0]);
        } else {
             throw new Error("API 返回的数据不是有效的 JSON 格式");
        }
    }

    // Ensure structure
    if (!data.social) data.social = [];
    if (!data.health) data.health = [];

    onLog(`解析成功 (社交: ${data.social.length}条, 健康: ${data.health.length}条)。`);
    return data;

  } catch (error: any) {
    onLog(`请求失败: ${error.message}`);
    throw error;
  }
};