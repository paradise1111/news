
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

  // UPGRADED PROMPT: Strict Date, Chinese Reason, 3 XHS Titles, Detailed Content
  const prompt = `
    You are an automated Daily Information Digest agent.
    
    ### TIME CONTEXT (CRITICAL)
    - **Current Date**: ${todayStr}
    - **TARGET NEWS DATE**: ${targetDateStr}
    - **STRICT RULE**: IGNORE ANY source dated before ${targetDateStr}. If a search result is from 2021, 2022, 2023, or early 2024, **REJECT IT**. Only select news from the last 48 hours.
    
    ### INSTRUCTIONS
    1. **LINKS**: Must be VALID and CLICKABLE. Verify using Google Search tool. No 404s.
    2. **LANGUAGE**: 
       - 'ai_score_reason': Must be in **CHINESE**.
       - 'summary_cn': Fluent, native-level Chinese. **Length: 80-120 words** (Not just a headline, give details).
       - 'summary_en': Concise English.
    
    3. **SCORING**: 
       - Differentiate scores (60-99).
       - Reason in Chinese (e.g., "涉及重大民生政策", "小众趣味话题").
    
    4. **XIAOHONGSHU (RED NOTE) STRATEGY**:
       - For Health/Lifestyle items, you act as a viral content creator.
       - Provide 'xhs_titles': An array of **3 different** clickbait/viral titles.
       - Style: Emotional, exaggerated, using keywords like "救命", "一定要看", "真相".
    
    ### TASKS
    **Task 1: Social/Trends** (10 items) - Economy, Tech, Society.
    **Task 2: Health/Life** (10 items) - Wellness, Diet, Biology. Focus on things people want to share on Red Note.

    ### OUTPUT FORMAT (JSON ONLY)
    {
      "social": [
        { 
          "title": "...", 
          "summary_en": "...", 
          "summary_cn": "Detailed summary here...", 
          "source_url": "...", 
          "source_name": "...", 
          "ai_score": 88, 
          "ai_score_reason": "中文打分理由...", 
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
          content: "You are a professional editor. You ONLY accept news from the last 24-48 hours. You REJECT old news. You output strictly valid JSON." 
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
        onLog("发送请求中 (严格过滤日期 + 生成三款爆款标题)...");
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
