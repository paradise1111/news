
import { AppConfig, DigestData, ModelOption, DigestItem } from "../types";
import { DEFAULT_MODELS } from "../constants";

/**
 * 基础 URL 处理：仅去除末尾斜杠，不再强制补全 /v1，完全尊重用户输入
 */
const normalizeBaseUrl = (url: string): string => {
  return url.trim().replace(/\/+$/, '');
};

/**
 * 健壮的 JSON 提取器：能够从 AI 的口语化回复或 Markdown 代码块中精准提取 JSON
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
    throw new Error(`解析 JSON 失败。内容摘要: ${text.substring(0, 100)}`);
};

/**
 * 链接有效性校验：通过后端代理检查链接是否可用
 */
const validateUrl = async (url: string): Promise<boolean> => {
    try {
        const response = await fetch('/api/proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                targetUrl: url,
                method: 'GET',
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
            }),
        });
        
        // 代理返回的是流。我们检查第一个数据块是否包含错误标识。
        const reader = response.body?.getReader();
        if (!reader) return false;
        
        const { value } = await reader.read();
        if (!value) return false;
        
        const chunk = new TextDecoder().decode(value);
        // 如果代理在建立连接时就报错，则认为链接无效
        if (chunk.includes('event: error') || chunk.includes('"error":')) {
            return false;
        }
        return response.ok;
    } catch {
        return false;
    }
};

/**
 * 核心 API 调用函数：支持 OpenAI 兼容格式，处理流式和非流式响应
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

  const contentType = response.headers.get('content-type') || '';
  
  if (contentType.includes('text/event-stream')) {
      const reader = response.body?.getReader();
      if (!reader) throw new Error("无法读取流数据");
      
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
                          errorMessage = parsed.error?.message || errorMessage || dataStr;
                      } else {
                          const delta = parsed.choices?.[0]?.delta?.content || parsed.choices?.[0]?.text || '';
                          fullContent += delta;
                      }
                  } catch (e) {
                      // 某些代理可能直接返回非 JSON 数据块
                      if (!hasError) fullContent += dataStr;
                  }
              }
          }
      }

      if (hasError) throw new Error(errorMessage || "API 调用出错");
      return fullContent;
  } else {
      const result = await response.json();
      if (result.error) throw new Error(result.error.message || "请求失败");
      return result;
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
  } catch {
    return DEFAULT_MODELS.map(m => ({ ...m, status: 'unknown' } as ModelOption));
  }
};

/**
 * 日报生成逻辑：执行“发现 -> 校验 -> 精编”三部曲
 */
export const generateDailyDigest = async (config: AppConfig, onLog: (msg: string) => void): Promise<DigestData> => {
  const todayStr = new Date().toISOString().split('T')[0];

  // --- 步骤 1: 资讯搜索 (Discovery) ---
  onLog("阶段 1: 正在检索今日热门资讯链接...");
  const discoveryPrompt = `
    搜索并列出 ${todayStr} 的热门资讯。
    要求：
    1. 找到 8-10 个“社会热点 (social)”链接和 8-10 个“健康生活 (health)”链接。
    2. 必须提供真实的原始文章深层链接（Deep Links），严禁造假。
    3. 仅输出 JSON 格式，结构如下：
    {"news": [{"title": "标题", "url": "真实链接", "category": "social/health"}]}
    注意：不要包含任何 Markdown 代码块，不要有开场白。
  `;

  const discoveryRaw = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', {
    model: config.model,
    messages: [
        { role: "system", content: "你是一个资讯搜索专家。请只返回 JSON 数据，不要包含任何多余文字。" },
        { role: "user", content: discoveryPrompt }
    ],
    stream: true,
    max_tokens: 2000,
    temperature: 0.3 // 降低随机性，减少幻觉
  });

  const discoveryData = extractJson(discoveryRaw);
  const candidates = (discoveryData.news || []) as { title: string, url: string, category: string }[];

  if (candidates.length === 0) throw new Error("未能搜索到有效资讯。");

  // --- 步骤 2: 链接校验 (Validation) ---
  onLog(`阶段 2: 正在验证 ${candidates.length} 条资讯链接的真实性...`);
  const validatedItems: { title: string, url: string, category: string }[] = [];
  
  // 并行验证链接，提升速度
  await Promise.all(candidates.map(async (item) => {
      const isValid = await validateUrl(item.url);
      if (isValid) {
          validatedItems.push(item);
      }
  }));

  if (validatedItems.length === 0) {
      throw new Error("搜索到的链接经校验均不可用（可能是模型幻觉），请尝试更换模型重试。");
  }
  onLog(`校验完成：${validatedItems.length} 条链接通过测试。`);

  // --- 步骤 3: 内容精编 (Elaboration) ---
  onLog("阶段 3: 正在基于真实链接生成深度摘要日报...");
  const elaborationPrompt = `
    基于以下已通过真实性校验的链接，编写今日日报 JSON。
    
    待处理资讯列表：
    ${validatedItems.map((v, i) => `${i+1}. [${v.category}] ${v.title} - 链接: ${v.url}`).join('\n')}

    每条资讯的要求：
    - title: 专业的中文标题。
    - summary_cn: 详细的中文深度摘要 (80-120字)。
    - summary_en: 简洁的英文摘要。
    - source_name: 来源媒体名称。
    - source_url: 必须使用上面提供的原始链接。
    - ai_score: 推荐指数 (60-99)。
    - ai_score_reason: 推荐理由 (中文)。
    - tags: 2-3个相关标签。
    - xhs_titles: (仅针对健康类) 提供3个适合小红书传播的爆款标题。

    输出格式：只返回纯 JSON 对象 {"social": [...], "health": [...]}
    禁止任何解释性文字或 Markdown 代码块标签。
  `;

  const elaborationRaw = await openAIFetch(config.baseUrl, config.apiKey, '/chat/completions', {
    model: config.model,
    messages: [
        { role: "system", content: "你是一个专业的日报主编。请严格按照 JSON 格式输出，不要有任何 Markdown 语法。" },
        { role: "user", content: elaborationPrompt }
    ],
    stream: true,
    max_tokens: 6000,
    temperature: 0.7
  });

  const finalData = extractJson(elaborationRaw);
  onLog("任务圆满完成！日报已生成。");
  return finalData as DigestData;
};
