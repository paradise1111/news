
import { AppConfig, DigestData, ModelOption } from "../types";
import { DEFAULT_MODELS } from "../constants";

// 更加灵活的 URL 处理：不强制补全，仅在必要时纠正
const normalizeBaseUrl = (url: string): string => {
  let cleaned = url.trim().replace(/\/+$/, '');
  if (!cleaned) return '';
  // 如果用户已经写了 /v1 或以其结尾，则保持原样
  if (cleaned.endsWith('/v1') || cleaned.includes('/v1/')) {
    return cleaned;
  }
  // 如果是一个纯域名，尝试补全 /v1
  if (!cleaned.includes('/')) {
    return `${cleaned}/v1`;
  }
  return cleaned;
};

/**
 * 极强容错的 JSON 提取器
 */
const extractJson = (str: string): any => {
    if (typeof str !== 'string') return str;
    const text = str.trim();
    if (!text) throw new Error("AI 返回了空内容。");

    // 1. 尝试直接解析
    try { return JSON.parse(text); } catch (e) {}

    // 2. 清理 Markdown 代码块
    let cleaned = text
        .replace(/^[\s\S]*?```json/g, '')
        .replace(/```[\s\S]*?$/g, '')
        .trim();
    
    try { return JSON.parse(cleaned); } catch (e) {}

    // 3. 寻找最后的 {} 结构
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    
    if (start !== -1 && end !== -1 && end > start) {
        const potentialJson = text.substring(start, end + 1);
        try {
            return JSON.parse(potentialJson);
        } catch (e) {
            // 尝试修复常见 JSON 错误（如末尾逗号）
            const sanitized = potentialJson
                .replace(/,\s*([\]}])/g, '$1')
                .replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
            try { return JSON.parse(sanitized); } catch (e2) {}
        }
    }
    
    throw new Error(`无法从输出中提取有效的 JSON 数据。内容摘要: ${text.substring(0, 100)}`);
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
        if (!reader) throw new Error("代理不支持流式传输");
        
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
                    const dataStr = trimmed.substring(6);
                    if (dataStr === '[DONE]') continue;
                    
                    try {
                        const parsed = JSON.parse(dataStr);
                        if (hasError) {
                            streamErrorMessage = parsed.error?.message || streamErrorMessage || dataStr;
                        } else {
                            // 兼容多种 OpenAI 流格式
                            const content = parsed.choices?.[0]?.delta?.content || 
                                           parsed.choices?.[0]?.text || 
                                           (typeof parsed === 'string' ? parsed : '');
                            fullContent += content;
                        }
                    } catch (e) {
                        if (!hasError) fullContent += dataStr;
                    }
                }
            }
        }

        if (hasError) throw new Error(streamErrorMessage || "流式连接中途报错");
        return fullContent;
    } 
    
    // 处理普通 JSON 响应
    const result = await response.json();
    
    // 关键：检查代理商返回的“伪 200”错误
    if (result.error) {
        const msg = result.error.message || result.error.type || JSON.stringify(result.error);
        throw new Error(`[API Error] ${msg}`);
    }

    if (!response.ok) {
        throw new Error(`HTTP 异常 (${response.status})`);
    }

    return result;

  } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') throw new Error("请求超时，请尝试更换模型或简化要求。");
      throw error;
  }
};

export const checkModelAvailability = async (apiKey: string, baseUrl: string, modelId: string) => {
  const start = Date.now();
  try {
    const res = await openAIFetch(baseUrl, apiKey, '/chat/completions', {
      model: modelId,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 5,
      stream: false
    });
    // 简单校验响应合法性
    if (res.choices || res.id || res.object === 'chat.completion') {
        return { available: true, latency: Date.now() - start };
    }
    throw new Error("响应格式不符合 OpenAI 标准");
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
  onLog(`正在启动任务 (模型: ${config.model})...`);

  // 针对自定义模型别名或特定中转，禁用可能导致 400 错误的参数
  const isCustomModel = config.model.includes('花之悦') || 
                        config.model.includes('tavo') || 
                        /[\u4e00-\u9fa5]/.test(config.model);

  const todayStr = new Date().toISOString().split('T')[0];
  const prompt = `
    Generate a JSON news digest for ${todayStr}.
    Requirements:
    - 6-10 items for "social" and 6-10 items for "health".
    - Output MUST be raw JSON.
    - NO Markdown code blocks (\`\`\`json).
    - NO conversational text before or after JSON.
    Format: {"social":[{"title":..., "summary_cn":..., "source_url":...}], "health":[...]}
  `;

  const payload: any = {
    model: config.model,
    messages: [
        { role: "system", content: "You are a JSON API. Output raw JSON only. NO conversational text. NO Markdown blocks." },
        { role: "user", content: prompt }
    ],
    stream: true,
    max_tokens: 4000,
    temperature: 0.7
  };

  // 仅在官方模型且不带中文字符的情况下尝试开启搜索
  if (!isCustomModel) {
      payload.tools = [{ googleSearch: {} }];
      payload.response_format = { type: "json_object" };
      onLog("启用 Google Search 增强内容...");
  } else {
      onLog("检测到自定义模型别名，已进入“兼容模式”（禁用搜索插件及强制 JSON 格式）...");
  }

  try {
    onLog("正在生成日报内容...");
    const rawContent = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', payload);
    
    // openAIFetch 在流模式下会返回拼接好的全量字符串
    const finalData = extractJson(rawContent);
    
    if (!finalData.social || !finalData.health) {
        throw new Error("AI 返回数据结构不完整。");
    }

    return finalData as DigestData;
  } catch (error: any) {
    onLog(`任务失败: ${error.message}`);
    throw error;
  }
};
