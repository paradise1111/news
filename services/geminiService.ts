import { AppConfig, DigestData, ModelOption } from "../types";
import { DEFAULT_MODELS } from "../constants";

// Helper: Normalize Base URL to ensure it ends with /v1 convention if missing
const normalizeBaseUrl = (url: string): string => {
  let cleaned = url.trim().replace(/\/+$/, '');
  
  if (!cleaned.endsWith('/v1')) {
      console.log(`[Auto-Fix] Appending /v1 to Base URL: ${cleaned} -> ${cleaned}/v1`);
      return `${cleaned}/v1`;
  }
  return cleaned;
};

// Generic Fetcher for OpenAI-Compatible APIs via Universal Edge Proxy
const openAIFetch = async (
  baseUrl: string,
  apiKey: string,
  endpoint: string,
  body?: any,
  method: string = 'POST'
) => {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  const targetUrl = `${normalizedBase}${endpoint}`;

  console.log(`[Proxy Request] -> ${method} ${targetUrl}`);

  // 120秒客户端超时 (因为服务端现在有 Keep-Alive，我们可以等更久)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000); 

  try {
    const response = await fetch('/api/proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        targetUrl: targetUrl,
        method,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: body 
      }),
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
       const errorText = await response.text();
       let errorJson;
       try { errorJson = JSON.parse(errorText); } catch { errorJson = { error: errorText || response.statusText }; }
       throw new Error(`Proxy Error (${response.status}): ${errorJson.error || JSON.stringify(errorJson)}`);
    }

    // --- 处理 SSE (Server-Sent Events) 响应 ---
    // 代理现在返回 text/event-stream 以保持连接活跃
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('text/event-stream')) {
        const reader = response.body?.getReader();
        if (!reader) throw new Error("ReadableStream not supported");
        
        const decoder = new TextDecoder();
        let buffer = '';
        let finalJsonString = '';
        let hasError = false;
        let errorMessage = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            // 保留最后一个可能不完整的片段
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    // 代理发送的数据是 JSON.stringify 过的字符串，所以需要解析一次得到原始 JSON 字符串
                    try {
                        const rawSegment = JSON.parse(line.substring(6));
                        finalJsonString += rawSegment;
                    } catch (e) {
                        console.warn("Parse warning on SSE chunk:", line);
                    }
                } else if (line.startsWith('event: error')) {
                    hasError = true;
                } else if (hasError && line.startsWith('data: ')) {
                    // 如果前一行是 event: error，这一行就是错误详情
                    try {
                        const errObj = JSON.parse(line.substring(6));
                        errorMessage = errObj.error || "Proxy Upstream Error";
                    } catch {
                        errorMessage = line.substring(6);
                    }
                }
            }
        }

        if (hasError || errorMessage) {
            throw new Error(errorMessage || "Stream Error");
        }
        
        if (!finalJsonString) {
            throw new Error("Stream closed without data");
        }

        return JSON.parse(finalJsonString);
    } 
    
    // 降级：如果不是 SSE，按普通 JSON 处理
    return await response.json();

  } catch (error: any) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
          console.error("Fetch Timeout:", targetUrl);
          throw new Error("请求超时 (120秒)。即便有心跳保活，任务依然耗时过长。");
      }
      
      console.error("Fetch Error Detail:", error);
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
    
    if (data && Array.isArray(data.data)) {
        const models = data.data.map((m: any) => ({
            id: m.id,
            name: m.id,
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
  onLog(`正在初始化 (API 模式: OpenAI 兼容 / 边缘心跳代理, 模型: ${config.model})...`);

  // Prompt updated to enforce using the search tool
  const prompt = `
    You are an automated Daily Information Digest agent.
    
    CRITICAL INSTRUCTION:
    You MUST use the provided 'googleSearch' tool to find REAL, CURRENT information.
    Do NOT hallucinate or make up news. If you cannot find a link using the tool, do not include the item.
    
    ### Task 1: Social Media & Trends (The "Pulse")
    - **Goal**: Identify the TOP 10 trending topics/news today using Google Search.
    - **Filter**: Ignore minor celebrity gossip. Focus on tech news, major cultural memes, or significant global discussions.
    - **Quantity**: Provide EXACTLY 10 distinct items.

    ### Task 2: Health & Science (The "Breakthroughs")
    - **Goal**: Find the TOP 10 high-impact medical or health news from reputable sources using Google Search.
    - **Quantity**: Provide EXACTLY 10 distinct items.

    ### Output Requirements (CRITICAL)
    1. **Depth**: Each English summary must be substantial (approx 60-80 words). Explain context, impact, and why it matters.
    2. **Translation**: Provide a fluent, professional Chinese translation of that summary.
    3. **Source**: You MUST provide the REAL URL (source_url) found via the search tool.
    4. **Format**: Return the result STRICTLY as a JSON object. No Markdown code blocks if possible, just raw JSON.

    The JSON structure must be:
    {
      "social": [
        { "title": "...", "summary_en": "...", "summary_cn": "...", "source_url": "http://...", "source_name": "..." },
      ],
      "health": [
      ]
    }
  `;

  const payload: any = {
    model: config.model,
    messages: [
      { 
          role: "system", 
          content: "You are a professional news analyst. You have access to Google Search. You must output valid JSON." 
      },
      { 
          role: "user", 
          content: prompt 
      }
    ],
    tools: [
        { googleSearch: {} }
    ],
    response_format: { type: "json_object" }
  };

  try {
    let responseData;
    
    try {
        onLog("发送请求中 (已启用 Google Search 联网)...");
        responseData = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', payload);
    } catch(err: any) {
        if (err.message.includes("tool") || err.message.includes("googleSearch") || err.message.includes("400")) {
             onLog("警告: 当前 API 渠道似乎不支持 Google Search 工具，正在尝试降级 (可能导致无真实链接)...");
             delete payload.tools;
             responseData = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', payload);
        }
        else if (err.message.includes("response_format")) {
            onLog("API 不支持 strict JSON 模式，正在降级重试...");
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

    let text = content.trim();
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

    if (!data.social) data.social = [];
    if (!data.health) data.health = [];

    onLog(`解析成功 (社交: ${data.social.length}条, 健康: ${data.health.length}条)。`);
    return data;

  } catch (error: any) {
    onLog(`请求失败: ${error.message}`);
    throw error;
  }
};