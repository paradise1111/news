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
      // Use defaults if fetch fails (logic inside service)
      const models = await verifyAndFetchModels(apiKey, baseUrl);
      
      // Save config to local storage
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ apiKey, baseUrl }));

      setAvailableModels(models);
      // Default to the first available model if not already set
      if (models.length > 0) {
        setModel(models[0].id);
      }
      setStep('model');
    } catch (err: any) {
      // Even if it throws (unlikely with new service logic), we fallback
      console.warn("Connection warning:", err);
      setAvailableModels(DEFAULT_MODELS);
      setModel(DEFAULT_MODELS[0].id);
      setStep('model');
      setError("无法验证 API Key，但已启用离线模式。如果 Key 无效，任务将失败。");
    } finally {
      setIsValidating(false);
    }
  };

  const handleStart = (e: React.FormEvent) => {
    e.preventDefault();
    if (!model) {
      setError("Please enter or select a model.");
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
                正在连接...
              </span>
            ) : '下一步'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleStart} className="space-y-6 animate-fadeIn">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              模型名称
            </label>
            <div className="relative">
              {/* 使用 input + datalist 实现可编辑的下拉框 */}
              <input
                list="model-options"
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="输入或选择模型..."
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
              />
              <datalist id="model-options">
                {availableModels.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </datalist>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              提示: 您可以直接输入自定义模型 ID (如中转 API 需要特定映射名)。
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
        <div className="mt-6 p-3 bg-yellow-50 text-yellow-800 border border-yellow-200 text-sm rounded-lg flex items-center animate-shake break-all">
          <svg className="w-5 h-5 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
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