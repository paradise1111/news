
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
  
  // Format: YYYY-MM-DD
  const todayStr = today.toISOString().split('T')[0];
  const targetDateStr = yesterday.toISOString().split('T')[0];
  const targetDateHuman = yesterday.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  onLog(`当前日期: ${todayStr}`);
  onLog(`目标新闻日期: ${targetDateStr} (${targetDateHuman})`);

  // UPGRADED PROMPT: Zero Tolerance for Broken Links
  const prompt = `
    You are an automated Daily Information Digest agent.
    
    ### TIME CONTEXT (ABSOLUTE)
    - **Current Date**: ${todayStr}
    - **TARGET DATE**: ${targetDateStr}
    - **RULE**: IGNORE sources older than ${targetDateStr}.
    
    ### ANTI-HALLUCINATION PROTOCOL (ZERO TOLERANCE)
    1. **NO GUESSING**: Do NOT construct URLs (e.g., do not invent "cnn.com/2024/...").
    2. **VERBATIM ONLY**: You MUST use the *exact* URL returned by the Google Search tool.
    3. **VERIFY**: Check the link before adding it. If the search result is just "www.cnn.com" (Home Page), **DISCARD THE ITEM ENTIRELY**.
    4. **BETTER EMPTY THAN FAKE**: It is better to return 5 verified items with working deep links than 10 items with 404 links.
    5. **DEEP LINKS**: URLs must end in an article slug or ID (e.g., .html, /article/..., /news/...).

    ### INSTRUCTIONS
    1. **Language**: 
       - 'ai_score_reason': Chinese.
       - 'summary_cn': Detailed Chinese (80-120 words).
       - 'summary_en': Concise English.
    
    2. **XHS Strategy (Health/Life)**:
       - 'xhs_titles': Array of 3 viral/clickbait titles.
       - Tone: "Emotional", "Urgent", "Revealing".
    
    3. **Scoring**: Range 60-99.
    
    ### TASKS
    **Task 1: Social/Trends** (Find 5-10 VERIFIED items)
    **Task 2: Health/Life** (Find 5-10 VERIFIED items)

    ### OUTPUT FORMAT (JSON ONLY)
    {
      "social": [
        { 
          "title": "...", 
          "summary_en": "...", 
          "summary_cn": "...", 
          "source_url": "https://actual-verified-link...", 
          "source_name": "...", 
          "ai_score": 88, 
          "ai_score_reason": "...", 
          "tags": ["Tag1"] 
        }
      ],
      "health": [
        {
          ...,
          "xhs_titles": ["🔥Title 1", "Title 2", "Title 3"]
        }
      ]
    }
  `;

  const payload: any = {
    model: config.model,
    messages: [
      { 
          role: "system", 
          content: "You are a professional editor. You have ZERO TOLERANCE for fake or broken links. If you cannot find a specific deep link for a story in the search tools, you MUST SKIP that story. Do not invent URLs." 
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
        onLog("发送请求中 (严格链接审查模式)...");
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
