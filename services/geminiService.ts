
import { AppConfig, DigestData, ModelOption, DigestItem } from "../types";
import { DEFAULT_MODELS } from "../constants";

/**
 * 基础 URL 处理：确保不重复补全，且兼容性更高
 */
const normalizeBaseUrl = (url: string): string => {
  let clean = url.trim().replace(/\/+$/, '');
  if (!clean) return '';
  // 如果不包含 v1 且不是官方地址，则补全
  if (!clean.includes('/v1') && !clean.match(/googleapis\.com/)) {
    clean += '/v1';
  }
  return clean;
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
    throw new Error(`无法解析 JSON 数据。原始内容片段: ${text.substring(0, 100)}`);
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
 * 核心调用函数：修复了 SSE 错误提取逻辑
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
    const msg = typeof errData.error === 'object' ? JSON.stringify(errData.error) : (errData.error || response.statusText);
    throw new Error(msg);
  }

  const contentType = response.headers.get('content-type') || '';
  
  if (contentType.includes('text/event-stream')) {
      const reader = response.body?.getReader();
      if (!reader) throw new Error("无法建立数据流连接");
      
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
                          // 修复：处理嵌套的错误对象
                          const rawError = parsed.error;
                          errorMessage = typeof rawError === 'object' 
                            ? (rawError.message || JSON.stringify(rawError)) 
                            : (rawError || errorMessage);
                      } else {
                          fullContent += (parsed.choices?.[0]?.delta?.content || '');
                      }
                  } catch (e) {
                      if (!hasError) fullContent += dataStr;
                  }
              }
          }
      }

      if (hasError) throw new Error(errorMessage || "AI 渠道返回错误");
      return fullContent;
  } 
  
  return await response.json();
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
    return [];
  } catch (err: any) {
    console.error("Fetch models error:", err);
    throw err;
  }
};

export const generateDailyDigest = async (config: AppConfig, onLog: (msg: string) => void): Promise<DigestData> => {
  const todayStr = new Date().toISOString().split('T')[0];

  // --- 阶段 1: 发现 (Discovery) ---
  onLog(`[第一步] 正在通过联网搜索发现资讯 (日期: ${todayStr})...`);
  
  const discoveryPrompt = `
    你是一个资讯检索专家。请检索 ${todayStr} 发生的全球重大社会新闻和健康资讯。
    要求：
    1. 找到 10 个“社会热点 (social)”和 10 个“健康生活 (health)”的真实链接。
    2. 必须提供真实的原始深层 URL。
    3. 严禁虚构。
    4. 仅输出 JSON：{"candidates": [{"title": "标题", "url": "URL", "category": "social/health"}]}
  `;

  // 构造请求体，增加 googleSearch 尝试
  const discoveryPayload: any = {
    model: config.model,
    messages: [
        { role: "user", content: `System: 你是一个只输出 JSON 的资讯检索机器人。严禁输出任何非 JSON 内容。\n\nUser: ${discoveryPrompt}` }
    ],
    stream: true,
    max_tokens: 3000,
    temperature: 0.2
  };

  // 仅在模型名称包含 gemini 时尝试开启联网工具
  if (config.model.toLowerCase().includes('gemini')) {
    discoveryPayload.tools = [{ googleSearch: {} }];
  }

  let discoveryRaw;
  try {
      discoveryRaw = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', discoveryPayload);
  } catch (err: any) {
      if (err.message.includes('tool') || err.message.includes('400')) {
          onLog("提示：当前代理渠道可能不支持 googleSearch 工具，正在尝试不带工具的普通模式...");
          delete discoveryPayload.tools;
          discoveryRaw = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', discoveryPayload);
      } else {
          throw err;
      }
  }

  const discoveryData = extractJson(discoveryRaw);
  const candidates = (discoveryData.candidates || []) as { title: string, url: string, category: string }[];

  if (candidates.length === 0) throw new Error("未能搜索到候选链接。");

  // --- 阶段 2: 验证 (Validation) ---
  onLog(`[检查点] 正在对 ${candidates.length} 条链接进行连通性测试...`);
  const validatedItems: { title: string, url: string, category: string }[] = [];
  
  // 并行验证
  const validationResults = await Promise.all(candidates.map(async (item) => {
      const isValid = await validateUrl(item.url);
      return isValid ? item : null;
  }));

  validationResults.forEach(res => { if(res) validatedItems.push(res); });

  if (validatedItems.length === 0) {
      throw new Error("AI 提供的链接经校验全部失效。这通常是模型产生了“幻觉”。请换用更高阶的模型（如 Pro）或重试。");
  }
  onLog(`校验完成：${validatedItems.length} 条链接真实有效。`);

  // --- 阶段 3: 精编 (Elaboration) ---
  onLog(`[第二步] 正在精编 ${validatedItems.length} 条资讯的深度摘要...`);
  const elaborationPrompt = `
    基于以下真实链接，生成完整的 Daily Digest 日报 JSON。
    
    链接列表：
    ${validatedItems.map((v, i) => `${i+1}. [${v.category}] ${v.title} - ${v.url}`).join('\n')}

    每条资讯要求包含：title, summary_cn, summary_en, source_url, ai_score, ai_score_reason, tags, xhs_titles(仅限健康类)。
    仅输出 JSON：{"social": [...], "health": [...]}
  `;

  const elaborationRaw = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', {
    model: config.model,
    messages: [
        { role: "user", content: `System: 你是一个专业日报主编，请严格输出 JSON。\n\nUser: ${elaborationPrompt}` }
    ],
    stream: true,
    max_tokens: 6000,
    temperature: 0.7
  });

  return extractJson(elaborationRaw) as DigestData;
};
