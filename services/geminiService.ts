
import { AppConfig, DigestData, ModelOption } from "../types";
import { DEFAULT_MODELS } from "../constants";

// 更加灵活的 URL 处理
const normalizeBaseUrl = (url: string): string => {
  let cleaned = url.trim().replace(/\/+$/, '');
  if (!cleaned) return '';
  // 仅在用户输入了域名但完全没有路径时尝试补全，否则尊重用户输入
  if (!cleaned.includes('/') && !cleaned.startsWith('http')) {
      return `https://${cleaned}/v1`;
  }
  return cleaned;
};

/**
 * 极强容错的 JSON 提取器
 */
const extractJson = (str: string): any => {
    if (typeof str !== 'string') return str;
    const text = str.trim();
    if (!text) throw new Error("AI 返回了空响应。");

    // 尝试直接解析
    try { return JSON.parse(text); } catch (e) {}

    // 清理 Markdown
    let cleaned = text
        .replace(/^[\s\S]*?```json/g, '')
        .replace(/```[\s\S]*?$/g, '')
        .trim();
    
    try { return JSON.parse(cleaned); } catch (e) {}

    // 寻找 {} 结构
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
    
    throw new Error(`无法从输出中提取 JSON 数据。`);
};

const openAIFetch = async (
  baseUrl: string,
  apiKey: string,
  endpoint: string,
  body?: any,
  method: string = 'POST'
) => {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  const targetUrl = endpoint.startsWith('http') ? endpoint : `${normalizedBase}${endpoint}`;

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

    // 处理流式响应
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('text/event-stream')) {
        const reader = response.body?.getReader();
        if (!reader) throw new Error("Stream unsupported");
        
        const decoder = new TextDecoder();
        let buffer = '';
        let fullContent = '';
        let hasError = false;
        let streamErrorMessage = '';

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
                            streamErrorMessage = parsed.error?.message || streamErrorMessage || dataContent;
                        } else {
                            // 兼容多种流格式
                            const delta = parsed.choices?.[0]?.delta?.content || parsed.choices?.[0]?.text || '';
                            fullContent += delta;
                        }
                    } catch (e) {
                        // 非 JSON 数据直接累加
                        if (!hasError) fullContent += dataContent;
                    }
                }
            }
        }

        if (hasError) throw new Error(streamErrorMessage || "流式传输异常");
        return fullContent; // 注意：流式模式下这里返回的是字符串
    } 
    
    // 处理普通 JSON 响应
    const result = await response.json();
    
    // 关键修复：检查即使状态码为 200 时的内部错误
    if (result.error) {
        throw new Error(result.error.message || result.error.type || JSON.stringify(result.error));
    }

    if (!response.ok) {
        throw new Error(`请求失败 (${response.status})`);
    }

    return result;

  } catch (error: any) {
      clearTimeout(timeoutId);
      throw error;
  }
};

export const checkModelAvailability = async (apiKey: string, baseUrl: string, modelId: string) => {
  const start = Date.now();
  try {
    const res = await openAIFetch(baseUrl, apiKey, '/chat/completions', {
      model: modelId,
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 5,
      stream: false
    });
    // 确保返回了预期的 OpenAI 结构
    if (res.choices || res.id) {
        return { available: true, latency: Date.now() - start };
    }
    throw new Error("响应格式异常");
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
  onLog(`正在启动 (模型: ${config.model})...`);

  // 针对已知容易报错的别名模型禁用 search
  const isCustomModel = config.model.includes('花之悦') || config.model.includes('tavo');

  const todayStr = new Date().toISOString().split('T')[0];
  const prompt = `Generate a JSON news digest for ${todayStr}. Format: {"social":[], "health":[]}`;

  const payload: any = {
    model: config.model,
    messages: [
        { role: "system", content: "You are a JSON API. Output raw JSON only." },
        { role: "user", content: prompt }
    ],
    stream: true,
    max_tokens: 4000,
    temperature: 0.7
  };

  // 仅在非自定义模型上尝试开启 googleSearch
  if (!isCustomModel) {
      payload.tools = [{ googleSearch: {} }];
      payload.response_format = { type: "json_object" };
  }

  try {
    onLog("正在获取资讯...");
    const rawContent = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', payload);
    
    // openAIFetch 在流模式下返回的是字符串，需要解析
    const finalData = extractJson(rawContent);
    
    if (!finalData.social || !finalData.health) {
        throw new Error("AI 返回数据不完整。");
    }

    return finalData as DigestData;
  } catch (error: any) {
    onLog(`任务失败: ${error.message}`);
    throw error;
  }
};
