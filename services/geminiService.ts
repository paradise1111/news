
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

/**
 * 极强容错的 JSON 提取器
 */
const extractJson = (str: string): any => {
    const text = str.trim();
    if (!text) throw new Error("AI 返回了空响应。");

    try { return JSON.parse(text); } catch (e) {}

    let cleaned = text
        .replace(/^[\s\S]*?```json/g, '')
        .replace(/```[\s\S]*?$/g, '')
        .trim();
    
    try { return JSON.parse(cleaned); } catch (e) {}

    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    
    if (start !== -1 && end !== -1 && end > start) {
        const potentialJson = text.substring(start, end + 1);
        try {
            return JSON.parse(potentialJson);
        } catch (e) {
            const sanitized = potentialJson
                .replace(/,\s*([\]}])/g, '$1')
                .replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
            try { return JSON.parse(sanitized); } catch (e2) {}
        }
    }
    
    const snippet = text.length > 150 ? text.substring(0, 150) + "..." : text;
    throw new Error(`JSON 解析失败。模型输出内容不符合格式。摘要: ${snippet}`);
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
       // 增强错误解析：尝试解析代理返回的 JSON 错误
       try {
           const errJson = JSON.parse(errorText);
           if (errJson.error?.message) throw new Error(errJson.error.message);
           if (errJson.error?.type) throw new Error(`[Proxy Error] ${errJson.error.type}: ${errJson.error.code || ''}`);
       } catch (e: any) {
           if (e.message.includes('[Proxy Error]')) throw e;
       }
       throw new Error(`上游连接失败 (${response.status}): ${errorText.substring(0, 100)}`);
    }

    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('text/event-stream')) {
        const reader = response.body?.getReader();
        if (!reader) throw new Error("无法读取流响应");
        
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
                    
                    try {
                        const parsed = JSON.parse(dataContent);
                        if (hasError) {
                            errorMessage += (parsed.error?.message || dataContent);
                        } else {
                            const delta = parsed.choices?.[0]?.delta?.content;
                            const message = parsed.choices?.[0]?.message?.content;
                            if (delta) fullContent += delta;
                            else if (message) fullContent += message;
                        }
                    } catch (e) {
                        if (!hasError) fullContent += dataContent;
                    }
                }
            }
        }

        if (hasError) throw new Error(errorMessage || "AI 生成过程中发生错误");
        return extractJson(fullContent);
    } 
    
    const directJson = await response.json();
    if (directJson.choices?.[0]?.message?.content) {
        return extractJson(directJson.choices[0].message.content);
    }
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
  onLog(`正在尝试连接 (模型: ${config.model})...`);

  // 判断是否使用官方模型。如果是别名模型，则倾向于关闭 tools 以提高兼容性。
  const isOfficialGemini = config.model.toLowerCase().includes('gemini-') && !config.model.includes('-'); 
  // 实际上大部分中转对带汉字或前缀的模型名，处理 tools 都会报错。
  const useTools = !config.model.includes('花之悦') && !config.model.includes('tavo');

  const todayStr = new Date().toISOString().split('T')[0];
  const prompt = `
    Generate a JSON news digest for ${todayStr}.
    Format: { "social": [...], "health": [...] }
    Requirements:
    - 6-10 items per section.
    - summary_cn: Chinese, summary_en: English.
    - Valid source_url (use google search link if needed).
    - ai_score (0-100) and ai_score_reason (Chinese).
  `;

  const payload: any = {
    model: config.model,
    messages: [
        { role: "system", content: "You are a JSON API. Output raw JSON only. NO conversational text." },
        { role: "user", content: prompt }
    ],
    stream: true,
    max_tokens: 4000,
    temperature: 0.7,
    // 如果是自定义模型，尝试不发送 response_format 和 tools 以规避代理商报错
    response_format: useTools ? { type: "json_object" } : undefined
  };

  if (useTools) {
      payload.tools = [{ googleSearch: {} }];
      onLog("启用搜索插件增强内容质量...");
  } else {
      onLog("检测到非标模型别名，已进入‘高兼容性模式’（禁用搜索插件）...");
  }

  try {
    onLog("正在获取资讯并生成内容...");
    const data = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', payload);
    
    let finalData = data;
    if (data.choices?.[0]?.message?.content) {
        finalData = extractJson(data.choices[0].message.content);
    }
    
    if (!finalData.social || !finalData.health) {
        throw new Error("AI 返回数据格式不完整。");
    }

    return finalData as DigestData;
  } catch (error: any) {
    // 如果带 tools 报错，且这是第一次尝试，可以尝试自动重试不带 tools 的版本（可选）
    onLog(`请求失败: ${error.message}`);
    throw error;
  }
};
