
export const DEFAULT_MODELS = [
  // --- 2.5 Series (Latest) ---
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.5-flash-latest', name: 'Gemini 2.5 Flash (Latest)' },
  { id: 'gemini-2.5-flash-lite-latest', name: 'Gemini 2.5 Flash Lite' },
  { id: 'gemini-2.5-pro-preview', name: 'Gemini 2.5 Pro Preview' }, // Guess/Future proofing
  
  // --- 2.0 Series (Experimental) ---
  { id: 'gemini-2.0-flash-exp', name: 'Gemini 2.0 Flash Exp' },
  { id: 'gemini-2.0-pro-exp', name: 'Gemini 2.0 Pro Exp' },
  { id: 'gemini-exp-1206', name: 'Gemini Exp 1206' },

  // --- 3.0 Series (Preview) ---
  { id: 'gemini-3-pro-preview', name: 'Gemini 3.0 Pro' },

  // --- 1.5 Pro Series ---
  { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
  { id: 'gemini-1.5-pro-latest', name: 'Gemini 1.5 Pro (Latest)' },
  { id: 'gemini-1.5-pro-001', name: 'Gemini 1.5 Pro-001' },
  { id: 'gemini-1.5-pro-002', name: 'Gemini 1.5 Pro-002' },

  // --- 1.5 Flash Series ---
  { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
  { id: 'gemini-1.5-flash-latest', name: 'Gemini 1.5 Flash (Latest)' },
  { id: 'gemini-1.5-flash-001', name: 'Gemini 1.5 Flash-001' },
  { id: 'gemini-1.5-flash-002', name: 'Gemini 1.5 Flash-002' },
  { id: 'gemini-1.5-flash-8b', name: 'Gemini 1.5 Flash-8B' },
  { id: 'gemini-1.5-flash-8b-latest', name: 'Gemini 1.5 Flash-8B (Latest)' },

  // --- Legacy / Aliases (Common in proxies) ---
  { id: 'gemini-pro', name: 'Gemini Pro (1.0)' },
  { id: 'gemini-1.0-pro', name: 'Gemini 1.0 Pro' },
  { id: 'gemini-1.0-pro-latest', name: 'Gemini 1.0 Pro (Latest)' },
  { id: 'gemini-pro-vision', name: 'Gemini Pro Vision' },
  
  // --- Common Proxy Mappings (Try these if others fail) ---
  { id: 'google-gemini-pro', name: 'Google Gemini Pro (Proxy Alias)' },
  { id: 'gemini', name: 'Gemini (Generic)' }
];

// DIGITAL PRINT STYLE: Brutalist, High Contrast, Compact, Information Saturated
export const MOCK_EMAIL_STYLES = {
  container: "font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 3px solid #000000; color: #000000;",
  
  header: "background-color: #000000; color: #ffffff; padding: 24px 16px; border-bottom: 3px solid #000000;",
  headerTitle: "font-family: 'Impact', 'Arial Black', sans-serif; text-transform: uppercase; font-size: 32px; letter-spacing: -1px; line-height: 1; margin: 0;",
  headerMeta: "font-family: 'Courier New', Courier, monospace; font-size: 12px; margin-top: 8px; letter-spacing: 1px; opacity: 0.8;",
  
  sectionTitle: "background-color: #000000; color: #ffffff; font-family: 'Impact', 'Arial Black', sans-serif; font-size: 18px; text-transform: uppercase; padding: 4px 12px; display: inline-block; margin: 24px 0 0 -3px; transform: skewX(-10deg);",
  
  card: "border-bottom: 2px solid #000000; padding: 16px; display: block; background-color: #ffffff;",
  
  // Compact header line with score
  cardHeaderRow: "display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 8px;",
  
  cardTitle: "font-family: 'Helvetica Neue', Arial, sans-serif; font-weight: 900; font-size: 18px; line-height: 1.1; color: #000000; margin: 0; flex: 1;",
  
  scoreBadge: "background-color: #000000; color: #ffffff; font-family: 'Courier New', monospace; font-weight: bold; font-size: 14px; padding: 2px 6px; border-radius: 0; min-width: 32px; text-align: center;",
  
  tagsRow: "margin-bottom: 8px; font-size: 10px; text-transform: uppercase; font-weight: bold; font-family: monospace;",
  tag: "display: inline-block; background-color: #f0f0f0; border: 1px solid #000; padding: 1px 4px; margin-right: 4px; color: #000;",
  
  summaryCn: "font-family: Georgia, 'Times New Roman', serif; font-size: 15px; line-height: 1.4; color: #000000; margin-bottom: 6px; font-weight: 500;",
  
  footer: "border-top: 3px solid #000000; background-color: #f4f4f4; padding: 20px; text-align: center; font-family: 'Courier New', monospace; font-size: 11px; color: #000000; font-weight: bold; text-transform: uppercase;"
};
