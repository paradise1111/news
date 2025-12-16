
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

  // 180秒客户端超时
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180000); 

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
       
       const rawError = errorJson.error || errorJson;
       const errorDetail = typeof rawError === 'string' ? rawError : JSON.stringify(rawError);

       throw new Error(`Proxy Error (${response.status}): ${errorDetail}`);
    }

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
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmedLine = line.trim();
                if (!trimmedLine) continue;
                if (trimmedLine.startsWith(':')) continue;

                if (trimmedLine.startsWith('event: error')) {
                    hasError = true;
                } else if (trimmedLine.startsWith('data: ')) {
                    const dataContent = trimmedLine.substring(6);
                    if (dataContent === '[DONE]') continue;
                    
                    if (hasError) {
                        try {
                            const errObj = JSON.parse(dataContent);
                            const rawErr = errObj.error || errObj.message || errObj;
                            errorMessage = typeof rawErr === 'string' ? rawErr : JSON.stringify(rawErr);
                        } catch {
                            errorMessage = dataContent;
                        }
                    } else {
                        try {
                            const parsed = JSON.parse(dataContent);
                            if (parsed.choices?.[0]?.delta?.content) {
                                finalJsonString += parsed.choices[0].delta.content;
                            } else if (parsed.choices?.[0]?.text) {
                                finalJsonString += parsed.choices[0].text;
                            } else if (typeof parsed === 'string') {
                                finalJsonString += parsed; 
                            } else if (parsed.choices?.[0]?.message?.content) {
                                finalJsonString = parsed.choices[0].message.content;
                            }
                        } catch (e) { }
                    }
                }
            }
        }

        if (hasError || errorMessage) {
            throw new Error(errorMessage || "Stream Error (Unknown)");
        }
        
        if (!finalJsonString || !finalJsonString.trim()) {
            throw new Error("Stream finished but content is empty.");
        }

        try {
            return JSON.parse(finalJsonString);
        } catch (e) {
            const firstBrace = finalJsonString.indexOf('{');
            const lastBrace = finalJsonString.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                const extracted = finalJsonString.substring(firstBrace, lastBrace + 1);
                try {
                    return JSON.parse(extracted);
                } catch (e2) {
                     console.error("Failed to parse extracted JSON block");
                }
            }
            throw new Error("API response was not valid JSON.");
        }
    } 
    
    return await response.json();

  } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
          throw new Error("请求超时。任务耗时过长，建议减少生成内容数量。");
      }
      throw error;
  }
};

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
    console.log("Fetching models list from OpenAI-compatible endpoint...");
    const data = await openAIFetch(baseUrl, apiKey, '/models', undefined, 'GET');
    
    if (data && Array.isArray(data.data)) {
        const models = data.data.map((m: any) => ({
            id: m.id,
            name: m.id,
            status: 'unknown'
        }));
        return models.length > 0 ? models : DEFAULT_MODELS.map(m => ({ ...m, status: 'unknown' } as ModelOption));
    }
    return DEFAULT_MODELS.map(m => ({ ...m, status: 'unknown' } as ModelOption));
  } catch (e: any) {
    return DEFAULT_MODELS.map(m => ({ ...m, status: 'unknown' } as ModelOption));
  }
};

export const generateDailyDigest = async (
  config: AppConfig, 
  onLog: (msg: string) => void
): Promise<DigestData> => {
  onLog(`正在初始化 (API 模式: OpenAI 兼容流式, 模型: ${config.model})...`);

  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  
  const targetDateStr = yesterday.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const queryDateStr = yesterday.toISOString().split('T')[0];

  onLog(`设定目标日期: ${queryDateStr}`);

  // UPGRADED PROMPT: Xiaohongshu Strategy + Strict Link Checking + Score Differentiation
  const prompt = `
    You are an automated Daily Information Digest agent.
    
    ### CONTEXT
    Today is ${today.toISOString().split('T')[0]}.
    **TARGET DATE FOR NEWS: ${targetDateStr} (${queryDateStr}).**
    
    ### CRITICAL INSTRUCTIONS
    1. **LINKS (PRIORITY #1)**: 
       - You MUST provide a **valid, real, and clickable** 'source_url' for every item. 
       - **VERIFY** via the search tool. Do not guess links. If the link is 404, the item is useless.
    
    2. **SCORING (CURVED)**:
       - **DO NOT** rate everything 90+. 
       - Use the full range: 60 (Boring) to 99 (Viral/Explosive).
       - Average items should be ~75.
       - 'ai_score_reason' must be 3-5 words explaining WHY (e.g., "Niche audience only" or "Global headline").
    
    3. **CONTENT CREATION (Xiaohongshu/Red Note)**:
       - For every item (especially Health), provide 'xiaohongshu_advice'.
       - This is a tip for a content creator.
       - Format: "Title Idea: [Clickbait Title] | Angle: [Unique Perspective]"
    
    ### Task 1: Current Events (The "World")
    - Scope: Economy, Politics, Culture.
    - Quantity: 10 items.

    ### Task 2: Health & Hygiene (The "Body")
    - Scope: Public health, medical studies, wellness, diet.
    - Quantity: 10 items.
    - **Focus**: Find items suitable for "Life Hacks" or "Wellness Tips" content.

    ### Output Requirements
    - Strict JSON.
    
    JSON Structure:
    {
      "social": [
        { 
          "title": "...", 
          "summary_en": "...", 
          "summary_cn": "...", 
          "source_url": "...", 
          "source_name": "...", 
          "ai_score": 82, 
          "ai_score_reason": "High local interest", 
          "xiaohongshu_advice": "Title: Why everyone is talking about X... | Angle: Focus on the money aspect",
          "tags": ["Tag1"] 
        }
      ],
      "health": [...]
    }
  `;

  const payload: any = {
    model: config.model,
    messages: [
      { 
          role: "system", 
          content: "You are a professional news analyst. Output valid JSON only. Never fabricate URLs. Act as a Content Strategist." 
      },
      { 
          role: "user", 
          content: prompt 
      }
    ],
    stream: true,
    tools: [
        { googleSearch: {} }
    ],
    response_format: { type: "json_object" }
  };

  const isDeepSeek = config.model.toLowerCase().includes('deepseek');
  if (isDeepSeek) {
     console.log("DeepSeek model detected: Removing explicit Google Search tool definition.");
     delete payload.tools;
  }

  try {
    let responseData;
    
    try {
        onLog("发送请求中 (搜索链接 + 生成小红书文案建议)...");
        responseData = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', payload);

    } catch(err: any) {
        const errorMsg = (err.message || '').toLowerCase();
        console.warn("First attempt failed:", errorMsg);

        if (
            errorMsg.includes("tool") || 
            errorMsg.includes("googlesearch") || 
            errorMsg.includes("response_format") ||
            errorMsg.includes("bad_response_status_code") || 
            errorMsg.includes("openai_error")
        ) {
             onLog(`自动降级重试中...`);
             if (payload.tools) delete payload.tools;
             if (payload.response_format) delete payload.response_format;
             responseData = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', payload);
        } else {
            throw err;
        }
    }

    if (!responseData) throw new Error("API Response is null");

    const data = responseData;
    onLog("数据接收完毕，正在校验结构...");

    if (!Array.isArray(data.social) && !Array.isArray(data.health)) {
        const values = Object.values(data);
        if (values.length > 0 && typeof values[0] === 'object') {
             return values[0] as DigestData;
        }
        throw new Error("JSON structure invalid.");
    }

    return data as DigestData;

  } catch (error: any) {
    const errorMsg = typeof error.message === 'string' ? error.message : JSON.stringify(error);
    onLog(`任务失败: ${errorMsg}`);
    throw error;
  }
};
