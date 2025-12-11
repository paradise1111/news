import { GoogleGenAI } from "@google/genai";
import { AppConfig, DigestData, ModelOption } from "../types";
import { DEFAULT_MODELS } from "../constants";

// Helper to create a client with dynamic configuration
const createClient = (config: { apiKey: string; baseUrl?: string }) => {
  const options: any = {
    apiKey: config.apiKey
  };
  
  if (config.baseUrl) {
    // Clean the Base URL: remove trailing slashes
    options.baseUrl = config.baseUrl.replace(/\/+$/, '');
  }

  return new GoogleGenAI(options);
};

// Test a single model's connectivity
export const checkModelAvailability = async (
  apiKey: string, 
  baseUrl: string, 
  modelId: string
): Promise<{ available: boolean; latency?: number; error?: string }> => {
  const ai = createClient({ apiKey, baseUrl });
  const start = Date.now();
  
  try {
    // Try a very simple generation task
    await ai.models.generateContent({
      model: modelId,
      contents: { parts: [{ text: "Hi" }] },
    });
    return { available: true, latency: Date.now() - start };
  } catch (error: any) {
    return { available: false, error: error.message || "Unknown error" };
  }
};

export const verifyAndFetchModels = async (apiKey: string, baseUrl: string): Promise<ModelOption[]> => {
  const ai = createClient({ apiKey, baseUrl });
  
  try {
    console.log("Attempting to fetch models from:", baseUrl || "Default Google Endpoint");
    
    // Attempt to list models
    const response: any = await ai.models.list();
    
    if (response && response.models) {
      const models = response.models
        .filter((m: any) => 
          m.supportedGenerationMethods?.includes('generateContent')
        )
        .map((m: any) => {
          const id = m.name.replace(/^models\//, '');
          return {
            id: id,
            name: m.displayName ? `${m.displayName} (${id})` : id,
            status: 'unknown'
          };
        });
        
      console.log(`Successfully fetched ${models.length} models.`);
      return models.length > 0 ? models : DEFAULT_MODELS.map(m => ({ ...m, status: 'unknown' } as ModelOption));
    }
    
    throw new Error("Empty model list");

  } catch (listError: any) {
    console.warn("Model listing failed, using defaults.", listError.message);
    return DEFAULT_MODELS.map(m => ({ ...m, status: 'unknown' } as ModelOption));
  }
};

export const generateDailyDigest = async (
  config: AppConfig, 
  onLog: (msg: string) => void
): Promise<DigestData> => {
  const ai = createClient({ apiKey: config.apiKey, baseUrl: config.baseUrl });

  onLog(`正在初始化模型: ${config.model}...`);

  // Prompt configuration
  const prompt = `
    You are an automated Daily Information Digest agent.
    
    ### Task 1: Social Media & Trends (The "Pulse")
    - **Goal**: Identify the TOP 10 trending topics/news today.
    - **Search Strategy**: DO NOT try to access x.com (Twitter) or youtube.com directly. 
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
    3. **Links**: The 'source_url' field MUST be a valid, absolute HTTP/HTTPS URL. Use actual URLs found by Google Search.
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

  // Helper to process response text
  const processResponseText = (text: string | undefined): DigestData => {
    if (!text) throw new Error("未能从 Gemini 接收到数据 (Empty Response)。");

    if (text.includes("```json")) {
        text = text.replace(/```json/g, "").replace(/```/g, "");
    } else if (text.includes("```")) {
        text = text.replace(/```/g, "");
    }
    text = text.trim();

    try {
        return JSON.parse(text);
    } catch (parseError) {
        console.warn("Direct JSON parse failed, attempting regex extraction", parseError);
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                return JSON.parse(jsonMatch[0]);
            } catch (e) {
                throw new Error("无法解析返回的数据格式 (JSON Invalid)");
            }
        } else {
             throw new Error("无法解析返回的数据格式 (No JSON found)");
        }
    }
  };

  // --- Attempt 1: With Google Search Tools ---
  try {
    onLog("尝试连接 Google Search 工具进行增强搜索...");
    
    const response = await ai.models.generateContent({
      model: config.model,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        systemInstruction: "You are a professional news analyst. You verify facts via Google Search before summarizing.",
      },
    });

    onLog("正在处理搜索结果...");
    const data = processResponseText(response.text);
    if (!data.social) data.social = [];
    if (!data.health) data.health = [];
    
    onLog(`内容生成完成 (社交: ${data.social.length}条, 健康: ${data.health.length}条)。`);
    return data;

  } catch (error: any) {
    // --- Fallback: Retry WITHOUT tools ---
    
    onLog(`增强模式失败 (${error.message || 'Unknown Error'})。`);
    onLog("正在尝试降级模式 (不使用 Google Search 工具)...");
    
    // Modify prompt slightly to acknowledge lack of real-time search
    const fallbackPrompt = prompt + `
    
    [IMPORTANT NOTE]
    Since you cannot access real-time search tools right now, please generate this digest based on your **latest available knowledge cutoff** or simulated trending data. 
    Make sure the content is realistic and high-quality, even if not strictly "live" from today.
    `;

    try {
        const response = await ai.models.generateContent({
          model: config.model,
          contents: fallbackPrompt,
          config: {
            // Remove tools
            systemInstruction: "You are a professional news analyst.",
          },
        });

        const data = processResponseText(response.text);
        if (!data.social) data.social = [];
        if (!data.health) data.health = [];

        onLog(`降级模式生成成功 (注意：数据可能不是实时联网的)。`);
        return data;
    } catch (fallbackError: any) {
        onLog(`降级模式也失败了: ${fallbackError.message}`);
        throw fallbackError;
    }
  }
};