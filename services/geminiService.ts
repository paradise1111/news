
import { AppConfig, DigestData, ModelOption, DigestItem } from "../types";
import { DEFAULT_MODELS } from "../constants";

const normalizeBaseUrl = (url: string): string => {
  let clean = url.trim().replace(/\/+$/, '');
  if (!clean) return '';
  if (!clean.includes('/v1') && !clean.match(/googleapis\.com/)) {
    clean += '/v1';
  }
  return clean;
};

const extractJson = (str: string): any => {
    if (typeof str !== 'string') return str;
    const text = str.trim();
    if (!text) throw new Error("AI 响应内容完全为空，请检查模型可用性或降低安全过滤等级。");

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
        try { return JSON.parse(potentialJson); } catch (e) {
            const sanitized = potentialJson.replace(/,\s*([\]}])/g, '$1').replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
            try { return JSON.parse(sanitized); } catch (e2) {}
        }
    }
    throw new Error(`JSON 解析失败。原始内容开头: ${text.substring(0, 100)}`);
};

const validateUrl = async (url: string): Promise<boolean> => {
    if (!url || !url.startsWith('http')) return false;
    try {
        const response = await fetch('/api/proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                targetUrl: url,
                method: 'GET',
                headers: { 'User-Agent': 'Mozilla/5.0' }
            }),
        });
        return response.ok;
    } catch { return false; }
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
      body: {
          ...body,
          // 尝试降低安全过滤（仅部分中转支持）
          safetySettings: [
              { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
          ]
      } 
    }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(errData.error?.message || errData.error || `HTTP ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  
  if (contentType.includes('text/event-stream')) {
      const reader = response.body?.getReader();
      if (!reader) throw new Error("无法读取流数据");
      
      const decoder = new TextDecoder();
      let fullContent = '';
      let hasError = false;
      let lastErrorMessage = '';

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
                          lastErrorMessage = parsed.error?.message || parsed.error || lastErrorMessage;
                      } else {
                          // 兼容多种格式：delta.content, delta.text, 或者直接 message.content
                          const content = parsed.choices?.[0]?.delta?.content 
                                       || parsed.choices?.[0]?.delta?.text
                                       || parsed.choices?.[0]?.text 
                                       || "";
                          fullContent += content;
                      }
                  } catch (e) {
                      // 如果 JSON 解析失败，可能是原始字符串（部分非标代理）
                      if (!hasError && !dataStr.startsWith('{')) fullContent += dataStr;
                  }
              }
          }
      }

      if (hasError) throw new Error(lastErrorMessage || "流式传输中断");
      if (!fullContent) {
          // 如果流结束了但内容为空，可能是安全策略拦截了所有输出
          throw new Error("模型响应为空。这通常是因为触发了 API 的安全审核策略，或者中转站配置有误。请尝试更换模型或修改 Prompt。");
      }
      return fullContent;
  } 
  
  const result = await response.json();
  return result.choices?.[0]?.message?.content || result;
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
    你是一个专业的新闻编辑。今天是 ${todayStr}。
    请搜索并列举今天全球发生的 10 条真实社会新闻和 10 条真实健康医疗进展。
    
    规则：
    1. 必须提供真实的原始长链接 (URL)，禁止缩写链接或伪造链接。
    2. 链接必须是可以直接访问的新闻正文页。
    3. 如果话题敏感，请选择较温和但真实的新闻。
    4. 严格以 JSON 格式输出：{"candidates": [{"title": "新闻标题", "url": "https://...", "category": "social"}]}
  `;

  const discoveryRaw = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', {
    model: config.model,
    messages: [
        { role: "user", content: `System: 你是一个只输出 JSON 且严格遵循新闻真实性的机器人。\n\nUser: ${discoveryPrompt}` }
    ],
    stream: true,
    max_tokens: 4000,
    temperature: 0.3
  });

  const discoveryData = extractJson(discoveryRaw);
  const candidates = (discoveryData.candidates || []) as { title: string, url: string, category: string }[];

  if (candidates.length === 0) throw new Error("模型未找到任何资讯链接，请尝试刷新重试。");

  // --- 阶段 2: 验证 ---
  onLog(`[检查点] 正在物理验证 ${candidates.length} 条链接...`);
  const validatedItems: { title: string, url: string, category: string }[] = [];
  
  const results = await Promise.all(candidates.map(async (item) => {
      const ok = await validateUrl(item.url);
      return ok ? item : null;
  }));

  results.forEach(r => { if(r) validatedItems.push(r); });

  if (validatedItems.length === 0) {
      throw new Error(`AI 提供的链接 (${candidates.length}个) 均不可访问或为虚假链接。请检查 API 渠道质量或更换 Pro 模型。`);
  }
  onLog(`成功验证：${validatedItems.length} 条真实有效链接。`);

  // --- 阶段 3: 精编 ---
  onLog(`[第二步] 正在基于验证成功的 ${validatedItems.length} 条链接生成摘要...`);
  const elaborationPrompt = `
    请根据以下验证成功的真实内容源，编写今日 Daily Digest 报表。
    
    源链接列表：
    ${validatedItems.map((v, i) => `${i+1}. [${v.category}] ${v.title} | ${v.url}`).join('\n')}

    要求：
    - summary_cn: 详细的中文总结，150字左右，客观专业。
    - summary_en: 简短的英文总结。
    - ai_score: 价值评分 (0-100)。
    - xhs_titles: 针对健康资讯，提供 3 个小红书风格的爆款标题。
    - 仅输出 JSON：{"social": [...], "health": [...]}
  `;

  const elaborationRaw = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', {
    model: config.model,
    messages: [
        { role: "user", content: `System: 你是一个金牌日报主编，请严格以 JSON 形式输出内容。\n\nUser: ${elaborationPrompt}` }
    ],
    stream: true,
    max_tokens: 6000,
    temperature: 0.6
  });

  return extractJson(elaborationRaw) as DigestData;
};
