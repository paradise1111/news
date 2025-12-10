import { GoogleGenAI } from "@google/genai";
import { AppConfig, DigestData } from "../types";
import { DEFAULT_MODELS } from "../constants";

// Helper to create a client with dynamic configuration
const createClient = (config: { apiKey: string; baseUrl?: string }) => {
  // Cast options to any to allow custom baseUrl which might not be in the strict type definition
  // This is necessary because the official TS types might not expose baseUrl/rootUrl despite the SDK supporting it.
  const options: any = {
    apiKey: config.apiKey
  };
  
  if (config.baseUrl) {
    options.baseUrl = config.baseUrl;
  }

  return new GoogleGenAI(options);
};

export const verifyAndFetchModels = async (apiKey: string, baseUrl: string): Promise<{id: string, name: string}[]> => {
  const ai = createClient({ apiKey, baseUrl });
  
  try {
    console.log("Attempting to fetch models from:", baseUrl || "Default Google Endpoint");
    
    // Attempt to list models
    // We cast to any to handle potential missing type definitions in the environment
    const response: any = await ai.models.list();
    
    if (response && response.models) {
      // Filter only for models that support content generation
      // We do NOT filter by name (e.g. 'gemini') to support all available models on the endpoint
      const models = response.models
        .filter((m: any) => 
          m.supportedGenerationMethods?.includes('generateContent')
        )
        .map((m: any) => {
          const id = m.name.replace(/^models\//, '');
          return {
            id: id,
            name: m.displayName ? `${m.displayName} (${id})` : id
          };
        });

      // Sort models: Flash and Pro versions first for convenience, but keep others
      models.sort((a: any, b: any) => {
        const score = (str: string) => {
          const s = str.toLowerCase();
          if (s.includes('flash')) return 3;
          if (s.includes('pro')) return 2;
          return 1;
        };
        return score(b.id) - score(a.id);
      });

      console.log(`Successfully fetched ${models.length} models from API.`);
      
      // Strictly return the models found on the website/API. 
      // If the API returns an empty list (but valid 200 OK), we return an empty list.
      return models;
    }
    
    // If response structure is unexpected
    throw new Error("Invalid response structure from Model List API");

  } catch (listError) {
    console.warn("Model listing failed, attempting fallback verification", listError);
    
    // Fallback: Verify key by generating a single token with a standard model
    // This handles cases where 'ListModels' permission is missing but 'GenerateContent' is allowed.
    // Only in this error case do we fall back to the hardcoded list.
    const fallbackModels = ['gemini-2.5-flash', 'gemini-1.5-flash'];
    
    for (const model of fallbackModels) {
        try {
            await ai.models.generateContent({
                model: model,
                contents: 'Ping',
            });
            console.log("Fallback verification successful using " + model);
            return DEFAULT_MODELS;
        } catch (verifyError) {
            console.warn(`Verification failed for ${model}:`, verifyError);
            // Continue to next model
        }
    }
    
    throw new Error("Connection failed: Unable to connect to Gemini API with standard models. Please check your API Key.");
  }
};

export const generateDailyDigest = async (
  config: AppConfig, 
  onLog: (msg: string) => void
): Promise<DigestData> => {
  const ai = createClient({ apiKey: config.apiKey, baseUrl: config.baseUrl });

  onLog(`正在初始化模型: ${config.model}...`);
  onLog("连接 Google Search 工具...");

  // Optimized Prompt:
  // 1. Requests exactly 10 items for Social and 10 items for Health.
  // 2. Enforces strict URL validity to fix broken links.
  const prompt = `
    You are an automated Daily Information Digest agent.
    
    ### Task 1: Social Media & Trends (The "Pulse")
    - **Goal**: Identify the TOP 10 trending topics/news today.
    - **Search Strategy**: DO NOT try to access x.com (Twitter) or youtube.com directly as they require login. 
    - **Instead, search for**: "top 10 trending topics on Twitter today summary", "viral YouTube videos today news report", and "tech news summaries today".
    - **Filter**: Ignore minor celebrity gossip. Focus on tech news, major cultural memes, or significant global discussions.
    - **Quantity**: Provide EXACTLY 10 distinct items.

    ### Task 2: Health & Science (The "Breakthroughs")
    - **Goal**: Find the TOP 10 high-impact medical or health news.
    - **Search Strategy**: Search for "top 10 medical breakthroughs last 24h summary" or "significant health study results published today".
    - **Source Check**: Prioritize reputable journals (Nature, Lancet) or major news outlets (BBC Health, CNN Health).
    - **Quantity**: Provide EXACTLY 10 distinct items.

    ### Output Requirements (CRITICAL)
    1. **Depth**: Each English summary must be substantial (approx 60-80 words). Explain context, impact, and why it matters.
    2. **Translation**: Provide a fluent, professional Chinese translation of that summary.
    3. **Links**: The 'source_url' field MUST be a valid, absolute HTTP/HTTPS URL (e.g., "https://www.bbc.com/news/..."). DO NOT generate fake URLs or relative paths. Use the actual URLs found by the Google Search tool.
    4. **Format**: Return the result STRICTLY as a JSON object.

    The JSON structure must be:
    {
      "social": [
        { "title": "...", "summary_en": "...", "summary_cn": "...", "source_url": "...", "source_name": "..." },
        // ... total 10 items
      ],
      "health": [
        // ... total 10 items
      ]
    }
  `;

  onLog("正在执行搜索任务 (目标: 10条热点 + 10条健康资讯)...");
  
  try {
    const response = await ai.models.generateContent({
      model: config.model,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }], // Enable grounding
        // Note: responseMimeType and responseSchema are NOT supported when using tools like googleSearch.
        systemInstruction: "You are a professional news analyst. You provide deep insights, not just headlines. You verify facts via Google Search before summarizing.",
      },
    });

    onLog("正在处理搜索结果...");
    let text = response.text;
    
    if (!text) {
      throw new Error("未能从 Gemini 接收到数据。");
    }

    // Clean up potential Markdown code blocks
    if (text.includes("```json")) {
        text = text.replace(/```json/g, "").replace(/```/g, "");
    } else if (text.includes("```")) {
        text = text.replace(/```/g, "");
    }
    text = text.trim();

    onLog("正在解析深度内容...");
    let data: DigestData;
    
    try {
        data = JSON.parse(text);
    } catch (parseError) {
        console.warn("Direct JSON parse failed, attempting regex extraction", parseError);
        // Fallback extraction
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                data = JSON.parse(jsonMatch[0]);
            } catch (e) {
                throw new Error("无法解析返回的数据格式 (JSON Invalid)");
            }
        } else {
             throw new Error("无法解析返回的数据格式 (No JSON found)");
        }
    }
    
    // Safety checks
    if (!data.social) data.social = [];
    if (!data.health) data.health = [];

    onLog(`内容生成完成 (社交: ${data.social.length}条, 健康: ${data.health.length}条)。`);
    return data;

  } catch (error) {
    onLog(`生成过程中出错: ${error instanceof Error ? error.message : '未知错误'}`);
    throw error;
  }
};