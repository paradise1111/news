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
       throw new Error(`Proxy Error (${response.status}): ${errorJson.error || JSON.stringify(errorJson)}`);
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
                            errorMessage = errObj.error || "Proxy Upstream Error";
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
                            // 2. 非标准/其他流式格式 (text)
                            else if (parsed.choices?.[0]?.text) {
                                finalJsonString += parsed.choices[0].text;
                            }
                            // 3. 代理包装的非流式完整响应 (Case B in proxy)
                            else if (typeof parsed === 'string') {
                                finalJsonString += parsed; // 如果代理发来的是简单的字符串片段
                            }
                            // 4. 某些模型直接返回完整 message 对象
                            else if (parsed.choices?.[0]?.message?.content) {
                                // 这是一个完整包，不是增量，通常不应该在流模式下发生，但为了兼容：
                                finalJsonString = parsed.choices[0].message.content;
                            }
                        } catch (e) {
                            // 忽略解析错误的行，可能是截断的 JSON
                        }
                    }
                }
            }
        }

        if (hasError || errorMessage) {
            throw new Error(errorMessage || "Stream Error (Unknown)");
        }
        
        if (!finalJsonString) {
            throw new Error("Stream closed without data");
        }

        // Final Parse
        try {
            return JSON.parse(finalJsonString);
        } catch (e) {
            console.error("Failed to parse reconstructed JSON. Raw string (last 200 chars):", finalJsonString.slice(-200));
            // 尝试简单的 Markdown 清理后再试一次
            try {
                const cleaned = finalJsonString.replace(/```json/g, "").replace(/```/g, "").trim();
                return JSON.parse(cleaned);
            } catch (e2) {
                 throw new Error("Proxy response was not valid JSON after streaming.");
            }
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

  // Reduced requirement to 4 items per category to improve speed and avoid timeouts
  const prompt = `
    You are an automated Daily Information Digest agent.
    
    ### CONTEXT
    Today is ${today.toISOString().split('T')[0]}.
    **TARGET DATE FOR NEWS: ${targetDateStr} (${queryDateStr}).**
    
    ### CRITICAL INSTRUCTION
    1. **SEARCH**: You MUST use your search tool (if available) to find events specifically from **${targetDateStr}**.
    2. **DIVERSITY**: Do NOT pick all stories from the same website. 
    
    ### Task 1: Social Media & Trends (The "Pulse")
    - **Goal**: Identify the TOP 4 trending topics from **${targetDateStr}**.
    - **Keywords**: "trending news ${queryDateStr}", "viral stories ${queryDateStr}".
    - **Quantity**: EXACTLY 4 items.

    ### Task 2: Health & Science (The "Breakthroughs")
    - **Goal**: Find the TOP 4 high-impact medical or science news from **${targetDateStr}**.
    - **Keywords**: "science news ${queryDateStr}", "health breakthrough ${queryDateStr}".
    - **Quantity**: EXACTLY 4 items.

    ### Output Requirements
    1. **Depth**: Concise summary (40-60 words).
    2. **Translation**: Provide a professional Chinese translation.
    3. **Format**: Return STRICT JSON.
    
    JSON Structure:
    {
      "social": [
        { "title": "...", "summary_en": "...", "summary_cn": "...", "source_url": "...", "source_name": "..." },
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
            onLog("发送请求中 (流式传输 + 搜索工具)...");
        } else {
            onLog("发送请求中 (DeepSeek 流式模式)...");
        }
        
        // Note: openAIFetch handles the stream and accumulates it into a final JSON object for us
        responseData = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', payload);

    } catch(err: any) {
        const errorMsg = (err.message || '').toLowerCase();
        console.warn("First attempt failed:", errorMsg);

        // Retry logic for common errors
        if (errorMsg.includes("tool") || errorMsg.includes("googlesearch") || errorMsg.includes("response_format")) {
             onLog(`首次请求遇到了不支持的参数 (${errorMsg})，正在降级重试...`);
             if (payload.tools) delete payload.tools;
             if (payload.response_format) delete payload.response_format; // Remove JSON mode if unsupported
             
             responseData = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', payload);
        } else {
            throw err;
        }
    }

    if (!responseData) {
        throw new Error("API Response is null or undefined.");
    }

    // Since we stream, openAIFetch already parsed the final string into JSON. 
    // We just need to validate the structure.
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
    onLog(`任务失败: ${error.message}`);
    throw error;
  }
};