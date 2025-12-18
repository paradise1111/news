
import { AppConfig, DigestData, ModelOption, DigestItem } from "../types";
import { DEFAULT_MODELS } from "../constants";

// 更加灵活的 URL 处理：不强制补全，仅在必要时纠正
const normalizeBaseUrl = (url: string): string => {
  let cleaned = url.trim().replace(/\/+$/, '');
  if (!cleaned) return '';
  if (cleaned.endsWith('/v1') || cleaned.includes('/v1/')) return cleaned;
  if (!cleaned.includes('/')) return `${cleaned}/v1`;
  return cleaned;
};

/**
 * 极强容错的 JSON 提取器
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
    throw new Error(`无法从输出中提取有效的 JSON 数据。`);
};

/**
 * 验证 URL 是否可用 (通过代理绕过 CORS)
 */
const validateUrl = async (url: string): Promise<boolean> => {
    try {
        const response = await fetch('/api/proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                targetUrl: url,
                method: 'HEAD', // 使用 HEAD 请求快速检查
                headers: { 'User-Agent': 'Mozilla/5.0' }
            }),
        });
        // 只要不是 404 或 5xx，且代理成功返回数据流/响应，我们姑且认为它存在
        // 注意：代理返回的是 SSE 流，如果 event 为 error 则代表失败
        const reader = response.body?.getReader();
        if (!reader) return false;
        
        const { value } = await reader.read();
        const decoder = new TextDecoder();
        const firstChunk = decoder.decode(value);
        return !firstChunk.includes('event: error');
    } catch {
        return false;
    }
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
    
    const result = await response.json();
    if (result.error) throw new Error(`[API Error] ${result.error.message || JSON.stringify(result.error)}`);
    if (!response.ok) throw new Error(`HTTP 异常 (${response.status})`);
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
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 5,
      stream: false
    });
    if (res.choices || res.id) return { available: true, latency: Date.now() - start };
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
  const todayStr = new Date().toISOString().split('T')[0];
  const isCustomModel = config.model.includes('花之悦') || config.model.includes('tavo') || /[\u4e00-\u9fa5]/.test(config.model);

  // --- PHASE 1: DISCOVERY ---
  onLog("第一阶段：正在通过 AI 搜索最新资讯（防幻觉模式）...");
  const discoveryPrompt = `
    Search for trending news from ${todayStr}.
    Find 10 candidates for "social" and 10 candidates for "health".
    Return ONLY a JSON object with a 'news' array. 
    Each item: {"title": "...", "url": "...", "category": "social" | "health"}.
    ONLY use real deep links from search results. DO NOT invent URLs.
    Constraint: Output raw JSON, no Markdown.
  `;

  const discoveryPayload: any = {
    model: config.model,
    messages: [
        { role: "system", content: "You are a news researcher. Find real, high-quality news links. Output raw JSON only." },
        { role: "user", content: discoveryPrompt }
    ],
    stream: true,
    max_tokens: 2000,
    temperature: 0.5
  };
  if (!isCustomModel) discoveryPayload.tools = [{ googleSearch: {} }];

  const discoveryRaw = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', discoveryPayload);
  const discoveryData = extractJson(discoveryRaw);
  const candidates = (discoveryData.news || []) as { title: string, url: string, category: string }[];

  if (candidates.length === 0) throw new Error("未搜索到任何有效资讯候选项。");

  // --- PHASE 2: VALIDATION ---
  onLog(`第二阶段：正在验证 ${candidates.length} 条链接的可用性...`);
  const validatedItems: { title: string, url: string, category: string }[] = [];
  
  // 并行验证
  await Promise.all(candidates.map(async (item) => {
      const isValid = await validateUrl(item.url);
      if (isValid) {
          validatedItems.push(item);
      }
  }));

  if (validatedItems.length === 0) throw new Error("搜索到的链接全部失效，请尝试更换模型重试。");
  onLog(`验证成功：${validatedItems.length} 条链接有效。`);

  // --- PHASE 3: ELABORATION ---
  onLog("第三阶段：正在针对验证过的链接生成精编摘要...");
  const elaborationPrompt = `
    Based on the following VERIFIED news links, generate a detailed Daily Digest in JSON format.
    
    Verified Links:
    ${validatedItems.map((v, i) => `${i+1}. [${v.category}] ${v.title} - URL: ${v.url}`).join('\n')}

    Requirements for each item:
    - title: Professional news title.
    - summary_cn: Detailed Chinese summary (80-120 words).
    - summary_en: Concise English summary.
    - source_name: The news portal name.
    - source_url: Use the exact URL provided above.
    - ai_score: 60-99.
    - ai_score_reason: Chinese explanation for the score.
    - tags: 2-3 relevant tags.
    - xhs_titles: (For health items only) 3 viral Red Note style titles.

    Output format: {"social": [...], "health": [...]}
    Output MUST be raw JSON. NO conversational text.
  `;

  const elaborationPayload: any = {
    model: config.model,
    messages: [
        { role: "system", content: "You are a professional editor. Summarize the provided news links accurately. Output raw JSON only." },
        { role: "user", content: elaborationPrompt }
    ],
    stream: true,
    max_tokens: 6000,
    temperature: 0.7
  };
  if (!isCustomModel) elaborationPayload.response_format = { type: "json_object" };

  const elaborationRaw = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', elaborationPayload);
  const finalData = extractJson(elaborationRaw);

  if (!finalData.social && !finalData.health) throw new Error("生成的内容结构异常。");
  
  onLog("任务全部完成！日报已就绪。");
  return finalData as DigestData;
};
