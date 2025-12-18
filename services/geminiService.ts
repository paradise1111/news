
import { AppConfig, DigestData, ModelOption, DigestItem } from "../types";
import { DEFAULT_MODELS } from "../constants";

/**
 * 基础 URL 处理：尊重用户输入，智能补全，防止重复添加 /v1
 */
const normalizeBaseUrl = (url: string): string => {
  let clean = url.trim().replace(/\/+$/, '');
  if (!clean) return '';
  
  // 如果已经包含 v1 或是一个完整的 endpoint 路径，不再补全
  if (clean.includes('/v1') || clean.includes('googleapis.com')) {
    return clean;
  }
  
  // 仅在域名级别自动补全 /v1
  return `${clean}/v1`;
};

/**
 * 通用 JSON 提取器
 */
const extractJson = (str: string): any => {
    if (typeof str !== 'string') return str;
    const text = str.trim();
    if (!text) throw new Error("AI 返回了空内容。");

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
    throw new Error(`无法解析 JSON 数据。`);
};

/**
 * 链接有效性校验
 */
const validateUrl = async (url: string): Promise<boolean> => {
    try {
        const response = await fetch('/api/proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                targetUrl: url,
                method: 'GET',
                headers: { 
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' 
                }
            }),
        });
        return response.ok;
    } catch {
        return false;
    }
};

/**
 * 核心调用函数：自动区分流式和普通 JSON 响应
 */
const openAIFetch = async (
  baseUrl: string,
  apiKey: string,
  endpoint: string,
  body?: any,
  method: string = 'POST'
) => {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  const targetUrl = endpoint.startsWith('http') ? endpoint : `${normalizedBase}${endpoint}`;

  const response = await fetch('/api/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || `请求失败 (${response.status})`);
  }

  const contentType = response.headers.get('content-type') || '';
  
  // 情况 1: 如果是流式响应
  if (contentType.includes('text/event-stream')) {
      const reader = response.body?.getReader();
      if (!reader) throw new Error("无法读取流");
      
      const decoder = new TextDecoder();
      let fullContent = '';
      let hasError = false;
      let errorMessage = '';

      while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

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
                          errorMessage = parsed.error || errorMessage;
                      } else {
                          fullContent += (parsed.choices?.[0]?.delta?.content || '');
                      }
                  } catch (e) {
                      if (!hasError) fullContent += dataStr;
                  }
              }
          }
      }

      if (hasError) throw new Error(errorMessage || "AI 响应异常");
      return fullContent;
  } 
  
  // 情况 2: 普通 JSON 响应 (如 /models)
  return await response.json();
};

export const checkModelAvailability = async (apiKey: string, baseUrl: string, modelId: string) => {
  const start = Date.now();
  try {
    await openAIFetch(baseUrl, apiKey, '/chat/completions', {
      model: modelId,
      messages: [{ role: "user", content: "ping" }],
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
    
    // OpenAI 标准格式: { data: [ { id: '...' }, ... ] }
    if (data && Array.isArray(data.data)) {
        return data.data.map((m: any) => ({ 
          id: m.id, 
          name: m.id, 
          status: 'unknown' 
        }));
    }
    
    // 如果返回的直接是列表 (某些非标代理)
    if (Array.isArray(data)) {
        return data.map((m: any) => ({ 
          id: typeof m === 'string' ? m : m.id, 
          name: typeof m === 'string' ? m : m.id, 
          status: 'unknown' 
        }));
    }
    
    return [];
  } catch (err) {
    console.error("Model fetch failed:", err);
    throw err;
  }
};

export const generateDailyDigest = async (config: AppConfig, onLog: (msg: string) => void): Promise<DigestData> => {
  const todayStr = new Date().toISOString().split('T')[0];

  // --- 阶段 1: 发现 (Discovery) ---
  onLog(`[第一步] 搜索资讯链接 (${todayStr})...`);
  const discoveryPrompt = `
    请作为检索专家，搜索 ${todayStr} 全球重大新闻。
    输出 10 条 social 和 10 条 health 真实链接。
    仅输出 JSON：{"candidates": [{"title": "标题", "url": "URL", "category": "social" | "health"}]}
  `;

  const discoveryRaw = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', {
    model: config.model,
    messages: [
        { role: "system", content: "你是一个只输出 JSON 的机器人。" },
        { role: "user", content: discoveryPrompt }
    ],
    stream: true,
    max_tokens: 2000,
    temperature: 0.2
  });

  const discoveryData = extractJson(discoveryRaw);
  const candidates = (discoveryData.candidates || []) as { title: string, url: string, category: string }[];

  if (candidates.length === 0) throw new Error("未能搜索到候选内容。");

  // --- 阶段 2: 验证 (Validation) ---
  onLog(`[检查点] 验证 ${candidates.length} 条链接...`);
  const validatedItems: { title: string, url: string, category: string }[] = [];
  
  await Promise.all(candidates.map(async (item) => {
      const isValid = await validateUrl(item.url);
      if (isValid) validatedItems.push(item);
  }));

  if (validatedItems.length === 0) throw new Error("链接验证全部失败（幻觉链接）。");
  onLog(`校验通过：${validatedItems.length} 条真实链接。`);

  // --- 阶段 3: 精编 (Elaboration) ---
  onLog(`[第二步] 生成深度精编内容...`);
  const elaborationPrompt = `
    基于以下真实链接编写 Daily Digest：
    ${validatedItems.map((v, i) => `${i+1}. [${v.category}] ${v.title} | ${v.url}`).join('\n')}
    输出格式：{"social": [...], "health": [...]}
  `;

  const elaborationRaw = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', {
    model: config.model,
    messages: [
        { role: "system", content: "你是一个专业日报编辑，只输出 JSON。" },
        { role: "user", content: elaborationPrompt }
    ],
    stream: true,
    max_tokens: 6000,
    temperature: 0.7
  });

  return extractJson(elaborationRaw) as DigestData;
};
