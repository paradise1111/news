
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

  // 180秒客户端超时 (流式传输可以允许更长时间)
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
       
       // FIX: Ensure error detail is a string, not [object Object]
       const rawError = errorJson.error || errorJson;
       const errorDetail = typeof rawError === 'string' ? rawError : JSON.stringify(rawError);

       throw new Error(`Proxy Error (${response.status}): ${errorDetail}`);
    }

    // --- 处理 SSE (Server-Sent Events) 响应 ---
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
                if (trimmedLine.startsWith(':')) continue; // Ignore comments (keep-alive)

                if (trimmedLine.startsWith('event: error')) {
                    hasError = true;
                } else if (trimmedLine.startsWith('data: ')) {
                    const dataContent = trimmedLine.substring(6);
                    if (dataContent === '[DONE]') continue; // OpenAI End Stream Marker
                    
                    if (hasError) {
                        try {
                            const errObj = JSON.parse(dataContent);
                            // FIX: Ensure errorMessage is a string
                            const rawErr = errObj.error || errObj.message || errObj;
                            errorMessage = typeof rawErr === 'string' ? rawErr : JSON.stringify(rawErr);
                        } catch {
                            errorMessage = dataContent;
                        }
                    } else {
                        try {
                            const parsed = JSON.parse(dataContent);
                            
                            // 1. 标准 OpenAI 流式格式 (delta.content)
                            if (parsed.choices?.[0]?.delta?.content) {
                                finalJsonString += parsed.choices[0].delta.content;
                            }
                            // 1b. DeepSeek 或其他 Thinking 模型 (delta.reasoning_content)
                            // 我们目前不显示思考过程，但需要防止因此导致的空响应报错
                            else if (parsed.choices?.[0]?.delta?.reasoning_content) {
                                // console.debug("Thinking...", parsed.choices[0].delta.reasoning_content);
                            }
                            // 2. 非标准/其他流式格式 (text)
                            else if (parsed.choices?.[0]?.text) {
                                finalJsonString += parsed.choices[0].text;
                            }
                            // 3. 代理包装的非流式完整响应 (Case B in proxy)
                            else if (typeof parsed === 'string') {
                                finalJsonString += parsed; 
                            }
                            // 4. 某些模型直接返回完整 message 对象
                            else if (parsed.choices?.[0]?.message?.content) {
                                finalJsonString = parsed.choices[0].message.content;
                            }
                        } catch (e) {
                            // 忽略解析错误的行
                        }
                    }
                }
            }
        }

        if (hasError || errorMessage) {
            throw new Error(errorMessage || "Stream Error (Unknown)");
        }
        
        // 如果最终字符串为空，可能是只输出了 thinking 过程，或者真的空了
        if (!finalJsonString || !finalJsonString.trim()) {
            throw new Error("Stream finished but content is empty. (Model may have only output reasoning or failed silently)");
        }

        // --- Robust Parsing Logic ---
        try {
            // 1. Try direct parse
            return JSON.parse(finalJsonString);
        } catch (e) {
            // 2. Try to find the JSON object boundaries (Best effort extraction)
            // This handles cases where model output contains markdown text before/after JSON
            const firstBrace = finalJsonString.indexOf('{');
            const lastBrace = finalJsonString.lastIndexOf('}');
            
            if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                const extracted = finalJsonString.substring(firstBrace, lastBrace + 1);
                try {
                    return JSON.parse(extracted);
                } catch (e2) {
                     console.error("Failed to parse extracted JSON block:", extracted.substring(0, 100) + "...");
                }
            }

            console.error("Final JSON Parse Failed. Raw content (start):", finalJsonString.substring(0, 200));
            throw new Error("API response was not valid JSON. Please check the 'Logs' for raw output.");
        }
    } 
    
    // 降级：如果不是 SSE，按普通 JSON 处理
    return await response.json();

  } catch (error: any) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
          console.error("Fetch Timeout:", targetUrl);
          throw new Error("请求超时。任务耗时过长，建议减少生成内容数量。");
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
      max_tokens: 5,
      stream: false // Test requests don't need streaming
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
  onLog(`正在初始化 (API 模式: OpenAI 兼容流式, 模型: ${config.model})...`);

  // --- Calculate Yesterday's Date for Better Search Results ---
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  
  const targetDateStr = yesterday.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const queryDateStr = yesterday.toISOString().split('T')[0];

  onLog(`设定目标日期: ${queryDateStr}`);

  // UPGRADED PROMPT: Diversity, Scoring, and Volume
  const prompt = `
    You are an automated Daily Information Digest agent acting as a Chief Editor.
    
    ### CONTEXT
    Today is ${today.toISOString().split('T')[0]}.
    **TARGET DATE FOR NEWS: ${targetDateStr} (${queryDateStr}).**
    
    ### CRITICAL INSTRUCTIONS
    1. **DIVERSITY**: You MUST consult different sources. Do not just pick 5 articles from the same domain.
    2. **AI SCORING**: Evaluate every story on 4 dimensions: **Novelty, Fun, Virality, Heat**. Calculate an aggregate "AI Score" (0-100).
    3. **TAGGING**: Assign 2 short, punchy tags for each item (e.g., "🔥 Viral", "🧠 Deep", "😲 Shocking").
    
    ### Task 1: Social Media & Trends (The "Pulse")
    - **Goal**: Identify the TOP 5 trending/viral topics from **${targetDateStr}**.
    - **Criteria**: High social engagement, surprising, or controversial.
    - **Quantity**: EXACTLY 5 items.

    ### Task 2: Health & Science (The "Breakthroughs")
    - **Goal**: Find the TOP 5 high-impact medical or science news from **${targetDateStr}**.
    - **Criteria**: Scientific breakthrough, new study, or weird science.
    - **Quantity**: EXACTLY 5 items.

    ### Output Requirements
    1. **Depth**: Concise summary (40-60 words).
    2. **Translation**: Provide a professional Chinese translation.
    3. **Format**: Return STRICT JSON.
    
    JSON Structure:
    {
      "social": [
        { 
          "title": "...", 
          "summary_en": "...", 
          "summary_cn": "...", 
          "source_url": "...", 
          "source_name": "...", 
          "ai_score": 95, 
          "tags": ["Tag1", "Tag2"] 
        },
      ],
      "health": [
        // ... 5 items
      ]
    }
  `;

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
    stream: true, // Enable Streaming to prevent 524 Timeouts
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
        if (!isDeepSeek) {
            onLog("发送请求中 (流式传输 + 多源搜索 + AI打分)...");
        } else {
            onLog("发送请求中 (DeepSeek 流式模式)...");
        }
        
        responseData = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', payload);

    } catch(err: any) {
        const errorMsg = (err.message || '').toLowerCase();
        console.warn("First attempt failed:", errorMsg);

        // Retry logic for common errors AND generic proxy errors (bad_response_status_code)
        if (
            errorMsg.includes("tool") || 
            errorMsg.includes("googlesearch") || 
            errorMsg.includes("response_format") ||
            errorMsg.includes("bad_response_status_code") || 
            errorMsg.includes("openai_error")
        ) {
             onLog(`首次请求遇到了兼容性问题 (${errorMsg.substring(0, 50)}...)。正在尝试自动降级 (移除搜索工具/强制JSON模式) 重试...`);
             if (payload.tools) delete payload.tools;
             // Some proxies also fail on response_format if tools failed
             if (payload.response_format) delete payload.response_format;
             
             responseData = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', payload);
        } else {
            throw err;
        }
    }

    if (!responseData) {
        throw new Error("API Response is null or undefined.");
    }

    const data = responseData;

    onLog("数据接收完毕，正在校验结构...");

    // Basic Validation
    if (!Array.isArray(data.social) && !Array.isArray(data.health)) {
        const values = Object.values(data);
        if (values.length > 0 && typeof values[0] === 'object') {
             onLog("检测到嵌套 JSON 结构，自动修复...");
             return values[0] as DigestData;
        }
        throw new Error("JSON structure is missing 'social' or 'health' arrays.");
    }

    return data as DigestData;

  } catch (error: any) {
    const errorMsg = typeof error.message === 'string' ? error.message : JSON.stringify(error);
    onLog(`任务失败: ${errorMsg}`);
    throw error;
  }
};
