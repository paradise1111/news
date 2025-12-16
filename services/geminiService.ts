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
                const trimmedLine = line.trim();
                if (!trimmedLine) continue;

                if (trimmedLine.startsWith('event: error')) {
                    hasError = true;
                } else if (trimmedLine.startsWith('data: ')) {
                    const dataContent = trimmedLine.substring(6); // Remove "data: "
                    
                    if (hasError) {
                        try {
                            const errObj = JSON.parse(dataContent);
                            errorMessage = errObj.error || "Proxy Upstream Error";
                        } catch {
                            errorMessage = dataContent;
                        }
                    } else {
                        // CRITICAL FIX: The proxy sends JSON.stringify(result).
                        // So dataContent is an escaped JSON string: "{\"id\":...}"
                        try {
                            const rawSegment = JSON.parse(dataContent);
                            // Ensure we don't concatenate null or undefined
                            if (rawSegment !== null && rawSegment !== undefined) {
                                if (typeof rawSegment === 'string') {
                                    finalJsonString += rawSegment;
                                } else {
                                    // Fallback if proxy sent raw object structure somehow
                                    finalJsonString += JSON.stringify(rawSegment);
                                }
                            }
                        } catch (e) {
                            console.warn("Parse warning on SSE chunk:", trimmedLine);
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
            console.error("Failed to parse reconstructed JSON. Raw string:", finalJsonString.substring(0, 200) + "...");
            throw new Error("Proxy response was not valid JSON.");
        }
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

  // --- Calculate Yesterday's Date for Better Search Results ---
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  
  // Format: "October 26, 2023"
  const targetDateStr = yesterday.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  // Format: "2023-10-26" (Good for search queries)
  const queryDateStr = yesterday.toISOString().split('T')[0];

  onLog(`设定目标日期: ${queryDateStr} (昨日热点)`);

  const prompt = `
    You are an automated Daily Information Digest agent.
    
    ### CONTEXT
    Today is ${today.toISOString().split('T')[0]}.
    **TARGET DATE FOR NEWS: ${targetDateStr} (${queryDateStr}).**
    
    ### CRITICAL INSTRUCTION
    1. **SEARCH**: You MUST use your search tool (if available) to find events specifically from **${targetDateStr}**.
    2. **DIVERSITY**: Do NOT pick 5 stories from the same website. 
       - Mix sources: Major news (CNN, BBC, Reuters), Tech blogs (The Verge, TechCrunch), and Social trends (Reddit, X/Twitter discussions).
       - Max 2 items from the same domain.
    3. **LINKS**: Ensure links are VALID and ACCESSIBLE. Do not invent URLs. If a specific article link is unstable, use the main category link of the publisher.
    
    ### Task 1: Social Media & Trends (The "Pulse")
    - **Goal**: Identify the TOP 5 trending topics from **${targetDateStr}**.
    - **Keywords to search**: "trending news ${queryDateStr}", "viral stories ${queryDateStr}", "top reddit posts ${queryDateStr}".
    - **Content**: Focus on major cultural moments, tech drama, or viral discussions.
    - **Quantity**: EXACTLY 5 distinct items.

    ### Task 2: Health & Science (The "Breakthroughs")
    - **Goal**: Find the TOP 5 high-impact medical or science news from **${targetDateStr}**.
    - **Keywords to search**: "science news ${queryDateStr}", "health breakthrough ${queryDateStr}".
    - **Quantity**: EXACTLY 5 distinct items.

    ### Output Requirements
    1. **Depth**: Summary must be substantial (60-80 words).
    2. **Translation**: Provide a professional Chinese translation.
    3. **Format**: Return STRICT JSON (No Markdown code blocks if possible).
    
    JSON Structure:
    {
      "social": [
        { "title": "...", "summary_en": "...", "summary_cn": "...", "source_url": "Must be a real URL", "source_name": "e.g. The Verge" },
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
          content: "You are a professional news analyst. Output valid JSON only. Do not output markdown tags." 
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

  const isDeepSeek = config.model.toLowerCase().includes('deepseek');
  if (isDeepSeek) {
     console.log("DeepSeek model detected: Removing explicit Google Search tool definition.");
     delete payload.tools;
  }

  try {
    let responseData;
    
    try {
        if (!isDeepSeek) {
            onLog("发送请求中 (尝试启用搜索工具)...");
        } else {
            onLog("发送请求中 (DeepSeek 模式)...");
        }
        
        responseData = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', payload);

    } catch(err: any) {
        const errorMsg = (err.message || '').toLowerCase();
        console.warn("First attempt failed:", errorMsg);

        const isToolError = errorMsg.includes("tool") || errorMsg.includes("googlesearch") || errorMsg.includes("400") || errorMsg.includes("invalid");
        const isNetworkError = errorMsg.includes("networkerror") || errorMsg.includes("fetch") || errorMsg.includes("stream error");
        const isResponseFormatError = errorMsg.includes("response_format");

        if (isToolError || isNetworkError) {
             onLog(`首次请求失败 (${errorMsg})，正在尝试移除工具并降级重试...`);
             if (payload.tools) delete payload.tools;
             responseData = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', payload);
        }
        else if (isResponseFormatError) {
            onLog("API 不支持 JSON 模式，正在降级为普通文本模式...");
            delete payload.response_format;
            if (payload.tools) delete payload.tools;
            responseData = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', payload);
        } else {
            throw err;
        }
    }

    if (!responseData) {
        throw new Error("API Response is null or undefined.");
    }

    if (responseData.error) {
        const msg = responseData.error.message || JSON.stringify(responseData.error);
        throw new Error(`API Returned Error: ${msg}`);
    }

    const content = responseData.choices?.[0]?.message?.content;
    
    if (typeof content !== 'string') {
        console.error("Invalid Response Structure:", responseData);
        throw new Error("Invalid API Response: Missing 'choices' or 'content' field. See console for details.");
    }

    onLog("接收到数据，正在解析...");

    // Remove markdown code blocks if present
    const cleanContent = content.replace(/```json/g, "").replace(/```/g, "").trim();

    try {
        const data = JSON.parse(cleanContent);
        
        // Basic Validation
        if (!Array.isArray(data.social) && !Array.isArray(data.health)) {
            // Sometimes it wraps in an extra object
            const values = Object.values(data);
            if (values.length > 0 && typeof values[0] === 'object') {
                 // Try to recover
                 onLog("检测到非标准 JSON 结构，尝试修复...");
                 return values[0] as DigestData;
            }
            throw new Error("JSON structure is missing 'social' or 'health' arrays.");
        }

        return data as DigestData;

    } catch (parseError) {
        console.error("JSON Parse Error. Raw content:", cleanContent);
        throw new Error(`Failed to parse API JSON response: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
    }

  } catch (error: any) {
    onLog(`任务失败: ${error.message}`);
    throw error;
  }
};