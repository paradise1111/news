
import { AppConfig, DigestData, ModelOption, DigestItem } from "../types";
import { DEFAULT_MODELS } from "../constants";

/**
 * 基础 URL 处理：确保路径正确，不重复添加 /v1，适配代理地址
 */
const normalizeBaseUrl = (url: string): string => {
  let clean = url.trim().replace(/\/+$/, '');
  if (!clean) return '';
  // 如果输入的是顶级域名且不含 /v1，也不是官方 google 地址，则补全 /v1
  if (!clean.includes('/v1') && !clean.match(/googleapis\.com/)) {
    clean += '/v1';
  }
  return clean;
};

/**
 * 鲁棒的 JSON 提取器
 */
const extractJson = (str: string): any => {
    if (typeof str !== 'string') return str;
    const text = str.trim();
    if (!text) throw new Error("AI 返回内容为空");

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
    throw new Error(`无法从响应中解析出 JSON 数据。原始内容: ${text.substring(0, 50)}...`);
};

/**
 * 链接有效性校验
 */
const validateUrl = async (url: string): Promise<boolean> => {
    if (!url || !url.startsWith('http')) return false;
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
 * 通用请求函数
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
    const errData = await response.json();
    // 这里的错误通常来自代理服务器自身
    const msg = typeof errData.error === 'object' 
      ? (errData.error.message || JSON.stringify(errData.error)) 
      : (errData.error || response.statusText);
    throw new Error(msg);
  }

  const contentType = response.headers.get('content-type') || '';
  
  if (contentType.includes('text/event-stream')) {
      const reader = response.body?.getReader();
      if (!reader) throw new Error("流读取器初始化失败");
      
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
                          // 如果 parsed.error 还是一个字符串化的 JSON，尝试再次解析
                          let detail = parsed.error;
                          try {
                              const inner = JSON.parse(detail);
                              detail = inner.error?.message || inner.message || detail;
                          } catch {}
                          errorMessage = detail;
                      } else {
                          fullContent += (parsed.choices?.[0]?.delta?.content || '');
                      }
                  } catch (e) {
                      if (!hasError) fullContent += dataStr;
                  }
              }
          }
      }

      if (hasError) throw new Error(errorMessage || "上游模型调用失败");
      return fullContent;
  } 
  
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
    if (data && Array.isArray(data.data)) {
        return data.data.map((m: any) => ({ id: m.id, name: m.id, status: 'unknown' }));
    }
    return [];
  } catch (err: any) {
    throw err;
  }
};

export const generateDailyDigest = async (config: AppConfig, onLog: (msg: string) => void): Promise<DigestData> => {
  const todayStr = new Date().toISOString().split('T')[0];

  // --- 阶段 1: 发现 ---
  onLog(`[第一步] 正在请求模型发现资讯链接...`);
  
  const discoveryPrompt = `
    你是一个专业的新闻检索助手。请提供 ${todayStr} 发生的全球 10 条社会热点和 10 条健康资讯。
    必须包含真实的原始 URL，严禁捏造。
    仅输出 JSON 格式：{"candidates": [{"title": "标题", "url": "URL", "category": "social" | "health"}]}
  `;

  // 彻底移除 tools，防止代理渠道不支持导致的 400 错误
  const discoveryRaw = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', {
    model: config.model,
    messages: [
        { role: "user", content: `System: 你是一个只输出 JSON 数据的机器人。\n\nUser: ${discoveryPrompt}` }
    ],
    stream: true,
    max_tokens: 3000,
    temperature: 0.1
  });

  const discoveryData = extractJson(discoveryRaw);
  const candidates = (discoveryData.candidates || []) as { title: string, url: string, category: string }[];

  if (candidates.length === 0) throw new Error("未获取到有效的候选资讯链接。");

  // --- 阶段 2: 验证 ---
  onLog(`[检查点] 正在物理验证 ${candidates.length} 条链接的连通性...`);
  const validatedItems: { title: string, url: string, category: string }[] = [];
  
  const results = await Promise.all(candidates.map(async (item) => {
      const ok = await validateUrl(item.url);
      return ok ? item : null;
  }));

  results.forEach(r => { if(r) validatedItems.push(r); });

  if (validatedItems.length === 0) {
      throw new Error("当前模型提供的链接均为幻觉链接或不可访问。建议更换更高级的模型（如 Pro）或检查 API 渠道。");
  }
  onLog(`校验完成：${validatedItems.length} 条链接真实可用。`);

  // --- 阶段 3: 精编 ---
  onLog(`[第二步] 正在基于真实链接生成精编摘要...`);
  const elaborationPrompt = `
    请根据以下真实资讯源，编写今日 Daily Digest。
    
    内容源：
    ${validatedItems.map((v, i) => `${i+1}. [${v.category}] ${v.title} | ${v.url}`).join('\n')}

    要求：
    - 中文摘要 summary_cn 需详细（150字）。
    - 包含 ai_score 和 ai_score_reason。
    - 健康类包含 xhs_titles。
    - 仅输出 JSON：{"social": [...], "health": [...]}
  `;

  const elaborationRaw = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', {
    model: config.model,
    messages: [
        { role: "user", content: `System: 你是一个专业日报主编。请严格输出 JSON 数据。\n\nUser: ${elaborationPrompt}` }
    ],
    stream: true,
    max_tokens: 5000,
    temperature: 0.7
  });

  return extractJson(elaborationRaw) as DigestData;
};
