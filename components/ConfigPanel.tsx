import React, { useState, useEffect } from 'react';
import { AppConfig, AppStatus, ModelOption } from '../types';
import { DEFAULT_MODELS } from '../constants';
import { verifyAndFetchModels, checkModelAvailability } from '../services/geminiService';

interface ConfigPanelProps {
  onConfigConfirmed: (config: AppConfig) => void;
  status: AppStatus;
}

const STORAGE_KEY = 'daily_pulse_config';

const ConfigPanel: React.FC<ConfigPanelProps> = ({ onConfigConfirmed, status }) => {
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [availableModels, setAvailableModels] = useState<ModelOption[]>(DEFAULT_MODELS.map(m => ({ ...m, status: 'unknown' } as ModelOption)));
  
  const [step, setStep] = useState<'credentials' | 'model'>('credentials');
  const [isValidating, setIsValidating] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

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
      
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ apiKey, baseUrl }));

      setAvailableModels(models);
      // Default to the first model if not set
      if (models.length > 0 && !model) {
        setModel(models[0].id);
      } else if (!model) {
        setModel(DEFAULT_MODELS[0].id);
      }
      setStep('model');
    } catch (err: any) {
      // Should rarely reach here due to service fallback, but just in case
      console.warn("Connection warning:", err);
      setAvailableModels(DEFAULT_MODELS.map(m => ({ ...m, status: 'unknown' } as ModelOption)));
      setModel(DEFAULT_MODELS[0].id);
      setStep('model');
    } finally {
      setIsValidating(false);
    }
  };

  const handleTestSingleModel = async () => {
    if (!model) return;
    setIsTesting(true);
    setTestResult(null);
    setError(null);
    
    const result = await checkModelAvailability(apiKey, baseUrl, model);
    
    if (result.available) {
      setTestResult(`连接成功! 延迟: ${result.latency}ms`);
    } else {
      setError(`连接失败: ${result.error}`);
    }
    setIsTesting(false);
  };

  const handleTestAllModels = async () => {
    setIsTesting(true);
    const updatedModels = [...availableModels];
    
    for (let i = 0; i < updatedModels.length; i++) {
      updatedModels[i] = { ...updatedModels[i], status: 'testing' };
      setAvailableModels([...updatedModels]);
      
      const result = await checkModelAvailability(apiKey, baseUrl, updatedModels[i].id);
      
      updatedModels[i] = { 
        ...updatedModels[i], 
        status: result.available ? 'available' : 'unavailable',
        latency: result.latency
      };
      setAvailableModels([...updatedModels]);
    }
    setIsTesting(false);
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
    setTestResult(null);
  };

  return (
    <div className="max-w-xl w-full bg-white rounded-xl shadow-2xl p-8 border border-gray-100 relative overflow-hidden">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-gray-800">Daily Pulse Setup</h2>
        <p className="text-gray-500 text-sm mt-2">
          {step === 'credentials' ? '连接 Gemini API' : '选择 & 测试模型'}
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
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Base URL (代理地址)
            </label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://... (无需 /v1beta)"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
            />
            <p className="text-xs text-gray-400 mt-1">注意：如果 API 提示 404，尝试移除 URL 末尾的 `/v1` 或 `/v1beta`。</p>
          </div>

          <button
            type="submit"
            disabled={isValidating}
            className={`w-full py-3 rounded-lg text-white font-semibold shadow-md transition-all 
              ${isValidating ? 'bg-blue-400 cursor-wait' : 'bg-blue-600 hover:bg-blue-700 active:scale-95'}`}
          >
            {isValidating ? '连接中...' : '下一步'}
          </button>
        </form>
      ) : (
        <div className="space-y-6 animate-fadeIn">
          <div>
            <div className="flex justify-between items-center mb-1">
               <label className="block text-sm font-medium text-gray-700">
                模型选择
              </label>
              <button 
                type="button"
                onClick={handleTestAllModels}
                disabled={isTesting}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium underline disabled:opacity-50"
              >
                {isTesting ? '正在检测...' : '🔎 全量检测可用性'}
              </button>
            </div>
           
            <div className="relative flex gap-2">
              <input
                list="model-options"
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="输入或选择模型..."
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
              />
               <button
                type="button"
                onClick={handleTestSingleModel}
                disabled={isTesting || !model}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium text-sm transition-colors border border-gray-200 whitespace-nowrap"
              >
                {isTesting ? '...' : '测试连接'}
              </button>
            </div>
            <datalist id="model-options">
              {availableModels.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </datalist>

            {/* Models Status List */}
            <div className="mt-4 max-h-48 overflow-y-auto border border-gray-100 rounded-lg bg-gray-50 p-2 text-xs">
                <p className="text-gray-400 mb-2 px-2">可用模型列表 (点击上方“全量检测”更新状态):</p>
                {availableModels.map((m) => (
                    <div 
                        key={m.id} 
                        onClick={() => setModel(m.id)}
                        className={`flex items-center justify-between p-2 rounded cursor-pointer hover:bg-white transition-colors ${model === m.id ? 'bg-blue-50 border border-blue-100' : ''}`}
                    >
                        <span className="font-medium truncate mr-2">{m.name || m.id}</span>
                        <div className="flex items-center gap-2 shrink-0">
                            {m.status === 'testing' && <span className="animate-spin w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full"></span>}
                            {m.status === 'available' && <span className="text-green-600 flex items-center gap-1">✅ <span className="text-[10px] opacity-70">{m.latency}ms</span></span>}
                            {m.status === 'unavailable' && <span className="text-red-500">❌</span>}
                            {m.status === 'unknown' && <span className="text-gray-300">⚪</span>}
                        </div>
                    </div>
                ))}
            </div>
          </div>

          {/* Messages */}
          {testResult && (
            <div className="p-3 bg-green-50 text-green-700 border border-green-200 text-sm rounded-lg flex items-center">
               <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
               {testResult}
            </div>
          )}
          
          {error && (
            <div className="p-3 bg-red-50 text-red-700 border border-red-200 text-sm rounded-lg flex items-center break-all">
              <svg className="w-5 h-5 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={handleBack}
              className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-lg transition-colors"
            >
              返回
            </button>
            <button
              type="button"
              onClick={handleStart}
              className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg shadow-md transition-all active:scale-95"
            >
              启动任务
            </button>
          </div>
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