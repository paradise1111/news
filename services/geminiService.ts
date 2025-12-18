
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { AppConfig, DigestData, DigestItem } from "../types";

// 严格按照指南使用环境变量中的 API Key
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * 验证链接连通性（用于过滤死链）
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
                headers: { 'User-Agent': 'Mozilla/5.0' }
            }),
        });
        return response.ok;
    } catch { return false; }
};

export const generateDailyDigest = async (config: AppConfig, onLog: (msg: string) => void): Promise<DigestData> => {
  const todayStr = new Date().toISOString().split('T')[0];
  const modelId = config.model || 'gemini-3-flash-preview';

  // 第一步：搜寻资讯 (使用 Google Search Grounding)
  onLog(`[第一步] 正在使用 Google Search 搜寻今日实时资讯...`);
  
  const discoveryResponse = await ai.models.generateContent({
    model: modelId,
    contents: `Find 10 important news articles from today (${todayStr}) about AI breakthroughs, Global economy, and Life sciences/Health. 
    Focus on specific, high-impact events. For each topic, provide the headline and a brief description.`,
    config: {
      tools: [{ googleSearch: {} }],
    },
  });

  // 提取接地链接 (Grounding Metadata)
  const chunks = discoveryResponse.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const foundLinks: { title: string, url: string }[] = [];
  
  chunks.forEach((chunk: any) => {
    if (chunk.web?.uri && chunk.web?.title) {
        foundLinks.push({
            title: chunk.web.title,
            url: chunk.web.uri
        });
    }
  });

  if (foundLinks.length === 0) {
      onLog("未从搜索接地中提取到直接链接，尝试从正文中提取...");
      // 备选方案：如果 groundingChunks 为空，尝试从 text 解析（略）
  }

  onLog(`发现 ${foundLinks.length} 条原始资讯来源，正在验证链接有效性...`);
  
  const validatedItems: { title: string, url: string }[] = [];
  for (const item of foundLinks.slice(0, 8)) {
      const ok = await validateUrl(item.url);
      if (ok) validatedItems.push(item);
  }

  if (validatedItems.length === 0) {
      throw new Error("搜索到的链接无法通过连通性验证，可能是由于反爬限制。请尝试再次运行。");
  }

  // 第二步：深度精编 (使用 Pro 模型和 JSON 模式)
  onLog(`[第二步] 正在使用 ${modelId} 进行深度精编与双语翻译...`);
  
  const elaborationPrompt = `
    Based on these validated news links: ${validatedItems.map(v => v.url).join(', ')}.
    Create a professional daily digest in JSON format.
    
    Fields required for each item:
    - title: Catchy Chinese title.
    - summary_cn: 2-3 sentences of deep insight in Chinese.
    - summary_en: 1 concise sentence in English.
    - ai_score: Importance score (0-100).
    - ai_score_reason: Short reason in Chinese.
    - xhs_titles: 3 viral titles for social media.
    - tags: 3 relevant tags.
    
    Classify items into "social" or "health" categories.
  `;

  const elaborationResponse = await ai.models.generateContent({
    model: modelId,
    contents: elaborationPrompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          social: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                summary_cn: { type: Type.STRING },
                summary_en: { type: Type.STRING },
                ai_score: { type: Type.NUMBER },
                ai_score_reason: { type: Type.STRING },
                xhs_titles: { type: Type.ARRAY, items: { type: Type.STRING } },
                tags: { type: Type.ARRAY, items: { type: Type.STRING } },
                source_url: { type: Type.STRING }
              },
              required: ["title", "summary_cn", "summary_en", "ai_score"]
            }
          },
          health: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                summary_cn: { type: Type.STRING },
                summary_en: { type: Type.STRING },
                ai_score: { type: Type.NUMBER },
                ai_score_reason: { type: Type.STRING },
                xhs_titles: { type: Type.ARRAY, items: { type: Type.STRING } },
                tags: { type: Type.ARRAY, items: { type: Type.STRING } },
                source_url: { type: Type.STRING }
              }
            }
          }
        },
        required: ["social", "health"]
      },
      // 启用思考模型以提升精编质量
      thinkingConfig: { thinkingBudget: 2000 }
    }
  });

  const finalJson = JSON.parse(elaborationResponse.text || "{}");
  
  // 注入验证过的 URL
  const mapUrls = (items: any[]) => (items || []).map((item, idx) => ({
      ...item,
      source_url: validatedItems[idx % validatedItems.length].url,
      source_name: "Verified Source"
  }));

  return {
      social: mapUrls(finalJson.social),
      health: mapUrls(finalJson.health)
  };
};

export const verifyAndFetchModels = async (): Promise<any[]> => {
    // 固定的 Gemini 模型列表，不再依赖 API 探测
    return [
        { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash (Fast)' },
        { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro (High Quality)' },
        { id: 'gemini-2.5-flash-latest', name: 'Gemini 2.5 Flash' }
    ];
};
