
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

        // --- JSON CLEANING LOGIC ---
        // 1. Remove Markdown code blocks (```json ... ```)
        let cleanRaw = finalJsonString
            .replace(/```json/g, '')
            .replace(/```/g, '')
            .trim();

        try {
            return JSON.parse(cleanRaw);
        } catch (e) {
            // 2. Fallback: Find first '{' and last '}'
            const firstBrace = cleanRaw.indexOf('{');
            const lastBrace = cleanRaw.lastIndexOf('}');
            
            if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                const extracted = cleanRaw.substring(firstBrace, lastBrace + 1);
                try {
                    return JSON.parse(extracted);
                } catch (e2) {
                     console.error("Failed to parse extracted JSON block:", e2);
                }
            }
            console.error("Invalid JSON String:", finalJsonString.substring(0, 200) + "...");
            throw new Error("API response was not valid JSON. (Parsing Failed)");
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
  yesterday.setDate(today.getDate() - 2); // Look back 48 hours to ensure content
  
  const todayStr = today.toISOString().split('T')[0];
  const targetDateStr = yesterday.toISOString().split('T')[0];

  onLog(`当前日期: ${todayStr}`);
  onLog(`搜索新闻范围: ${targetDateStr} 至今`);

  // UPGRADED PROMPT: Safe Links Strategy
  const prompt = `
    You are the Hajimi Daily Editor.
    
    ### TASK
    Generate a daily digest for TODAY (${todayStr}).
    Search for high-impact events from the last 48 hours.
    
    ### LINK SAFETY PROTOCOL (CRITICAL)
    Users hate 404 errors. You must ensure every link works.
    
    **Rule 1**: Try to find the exact article URL from the Google Search results.
    **Rule 2**: If you find a great story but CANNOT find the deep link (e.g., article slug), you MUST use a **Google Search URL** as the \`source_url\`.
       - Example: "https://www.google.com/search?q=SpaceX+Starship+Launch+Success"
    **Rule 3**: NEVER invent a URL path (e.g., do not make up "cnn.com/2024/05/22/story"). Invented paths are always 404s.
    **Rule 4**: It is better to have a Google Search link than a broken direct link.

    ### CONTENT REQUIREMENTS
    - **Quantity**: I need **8-12 items** for "social" and **8-12 items** for "health".
    - **Health/Life**: Focus on viral health tips, lifestyle hacks, or medical breakthroughs.
    - **Social/Trends**: Focus on global major events, tech news, or viral internet culture.

    ### OUTPUT FORMAT (JSON ONLY)
    {
      "social": [
        { 
          "title": "Title Here", 
          "summary_en": "Short English summary.", 
          "summary_cn": "Detailed Chinese summary (80 words).", 
          "source_url": "https://...", 
          "source_name": "CNN / Google Search", 
          "ai_score": 95, 
          "ai_score_reason": "High impact global event", 
          "tags": ["Tech", "Space"] 
        }
      ],
      "health": [
        {
          ...,
          "xhs_titles": ["🔥Viral Title 1", "Title 2", "Title 3"]
        }
      ]
    }
  `;

  const payload: any = {
    model: config.model,
    messages: [
      { 
          role: "system", 
          content: "You are a helpful news assistant. You prioritize WORKING LINKS. If you don't have a direct link, fallback to a Google Search Query URL. Do not generate 404 links." 
      },
      { 
          role: "user", 
          content: prompt 
      }
    ],
    stream: true,
    max_tokens: 8192,
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
        onLog("正在搜索并生成 (优先保证链接可用)...");
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
