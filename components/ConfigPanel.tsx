import React, { useState, useEffect } from 'react';
import { AppConfig, AppStatus } from '../types';
import { DEFAULT_MODELS } from '../constants';
import { verifyAndFetchModels } from '../services/geminiService';

interface ConfigPanelProps {
  onConfigConfirmed: (config: AppConfig) => void;
  status: AppStatus;
}

const STORAGE_KEY = 'daily_pulse_config';

const ConfigPanel: React.FC<ConfigPanelProps> = ({ onConfigConfirmed, status }) => {
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [availableModels, setAvailableModels] = useState<{id: string, name: string}[]>(DEFAULT_MODELS);
  
  const [step, setStep] = useState<'credentials' | 'model'>('credentials');
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load saved config on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.apiKey) setApiKey(parsed.apiKey);
        if (parsed.baseUrl) setBaseUrl(parsed.baseUrl);
      } catch (e) {
        console.error("Failed to parse saved config", e);
      }
    }
  }, []);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey) {
      setError("API Key is required");
      return;
    }

    setIsValidating(true);
    setError(null);

    try {
      const models = await verifyAndFetchModels(apiKey, baseUrl);
      
      // Save valid config
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ apiKey, baseUrl }));

      setAvailableModels(models);
      // Default to the first available model, preferably flash
      if (models.length > 0) {
        setModel(models[0].id);
      }
      setStep('model');
    } catch (err: any) {
      console.error("Connection error details:", err);
      // Handle complex error objects (like JSON responses)
      const message = err instanceof Error 
        ? err.message 
        : (typeof err === 'object' ? JSON.stringify(err) : String(err));
      
      setError(message || "Connection failed. Please check your API Key and Network.");
    } finally {
      setIsValidating(false);
    }
  };

  const handleStart = (e: React.FormEvent) => {
    e.preventDefault();
    if (!model) {
      setError("Please select a model.");
      return;
    }
    const config: AppConfig = { apiKey, baseUrl, model };
    onConfigConfirmed(config);
  };

  const handleBack = () => {
    setStep('credentials');
    setError(null);
  };

  return (
    <div className="max-w-md w-full bg-white rounded-xl shadow-2xl p-8 border border-gray-100 relative overflow-hidden">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-gray-800">Daily Pulse Setup</h2>
        <p className="text-gray-500 text-sm mt-2">
          {step === 'credentials' ? '连接 Gemini API' : '选择 AI 模型'}
        </p>
      </div>

      {step === 'credentials' ? (
        <form onSubmit={handleConnect} className="space-y-6 animate-fadeIn">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Gemini API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="AIzaSy..."
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
            />
            <p className="text-xs text-gray-400 mt-1">Key 仅存储在本地浏览器中。</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Base URL (可选 - 代理地址)
            </label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://generativelanguage.googleapis.com"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
            />
          </div>

          <button
            type="submit"
            disabled={isValidating}
            className={`w-full py-3 rounded-lg text-white font-semibold shadow-md transition-all 
              ${isValidating ? 'bg-blue-400 cursor-wait' : 'bg-blue-600 hover:bg-blue-700 active:scale-95'}`}
          >
            {isValidating ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                正在验证...
              </span>
            ) : '连接'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleStart} className="space-y-6 animate-fadeIn">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              选择模型
            </label>
            <div className="relative">
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none appearance-none bg-white"
              >
                {availableModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700">
                <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                  <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/>
                </svg>
              </div>
            </div>
            <p className="text-xs text-green-600 mt-2 flex items-center">
              <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/></svg>
              连接成功 (已加载 {availableModels.length} 个模型)
            </p>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleBack}
              className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-lg transition-colors"
            >
              返回
            </button>
            <button
              type="submit"
              className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg shadow-md transition-all active:scale-95"
            >
              启动任务
            </button>
          </div>
        </form>
      )}

      {error && (
        <div className="mt-6 p-3 bg-red-50 text-red-700 text-sm rounded-lg flex items-center animate-shake break-all">
          <svg className="w-5 h-5 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {error}
        </div>
      )}
      
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeIn {
          animation: fadeIn 0.3s ease-out forwards;
        }
      `}</style>
    </div>
  );
};

export default ConfigPanel;