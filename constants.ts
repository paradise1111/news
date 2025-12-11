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
];

export const MOCK_EMAIL_STYLES = {
  container: "font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f4f4f5;",
  header: "background-color: #2563eb; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;",
  sectionTitle: "color: #1e3a8a; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; margin-top: 24px; font-size: 1.25rem; font-weight: bold;",
  card: "background-color: white; padding: 16px; margin-bottom: 16px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);",
  cardTitle: "font-size: 1.1rem; font-weight: bold; color: #111827; margin-bottom: 8px;",
  summaryEn: "color: #374151; font-size: 0.95rem; line-height: 1.5; margin-bottom: 8px;",
  summaryCn: "color: #4b5563; font-size: 0.95rem; line-height: 1.5; border-left: 3px solid #3b82f6; padding-left: 12px; margin-bottom: 12px;",
  link: "color: #2563eb; text-decoration: none; font-size: 0.875rem;",
  footer: "text-align: center; font-size: 0.75rem; color: #9ca3af; margin-top: 32px;"
};