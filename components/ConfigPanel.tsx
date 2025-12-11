import React, { useState, useEffect, useRef } from 'react';
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
  
  const listRef = useRef<HTMLDivElement>(null);

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
      setError("Token / Key is required");
      return;
    }

    setIsValidating(true);
    setError(null);

    try {
      // Try to fetch models using the provided token/url
      const models = await verifyAndFetchModels(apiKey, baseUrl);
      
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ apiKey, baseUrl }));

      // If we got a real list from API, use it. Otherwise use our expanded DEFAULT_MODELS for manual testing.
      const modelsToUse = models.length > 0 ? models : DEFAULT_MODELS.map(m => ({ ...m, status: 'unknown' } as ModelOption));
      
      setAvailableModels(modelsToUse);
      
      // Select first valid/default model
      if (!model) {
        setModel(modelsToUse[0].id);
      }
      setStep('model');
    } catch (err: any) {
      console.warn("Connection warning:", err);
      // Fallback to default list
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
    setTestResult(null);
    setError(null);
    const updatedModels = [...availableModels];
    let successCount = 0;
    
    // Reset statuses first
    for(let i=0; i<updatedModels.length; i++) {
        updatedModels[i].status = 'unknown';
    }
    setAvailableModels([...updatedModels]);

    for (let i = 0; i < updatedModels.length; i++) {
      updatedModels[i] = { ...updatedModels[i], status: 'testing' };
      setAvailableModels([...updatedModels]);
      
      // Auto scroll to current item
      if (listRef.current) {
         const element = listRef.current.children[i+1] as HTMLElement; 
         if (element) {
             element.scrollIntoView({ behavior: 'smooth', block: 'center' });
         }
      }

      const result = await checkModelAvailability(apiKey, baseUrl, updatedModels[i].id);
      
      updatedModels[i] = { 
        ...updatedModels[i], 
        status: result.available ? 'available' : 'unavailable',
        latency: result.latency
      };
      
      if (result.available) {
          successCount++;
          if (successCount === 1) {
              setModel(updatedModels[i].id);
          }
      }
      
      setAvailableModels([...updatedModels]);
      
      await new Promise(r => setTimeout(r, 150));
    }
    
    setIsTesting(false);
    if (successCount === 0) {
        setError("所有模型均不可用。请检查 API Key 权限或 Base URL 是否正确 (需包含 /v1)。");
    } else {
        setTestResult(`测试完成。共发现 ${successCount} 个可用模型。`);
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
    setTestResult(null);
  };

  return (
    <div className="max-w-xl w-full bg-white rounded-xl shadow-2xl p-8 border border-gray-100 relative overflow-hidden flex flex-col max-h-[90vh]">
      <div className="text-center mb-6 shrink-0">
        <h2 className="text-2xl font-bold text-gray-800">Daily Pulse Setup</h2>
        <p className="text-gray-500 text-sm mt-2">
          {step === 'credentials' ? '配置 API 令牌 (One API / OpenAI 格式)' : '模型连通性测试'}
        </p>
      </div>

      {step === 'credentials' ? (
        <form onSubmit={handleConnect} className="space-y-6 animate-fadeIn overflow-y-auto p-1">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              服务令牌 (Token) / API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Base URL (API 接口地址)
            </label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="例如: https://oneapi.site/v1"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
            />
            <div className="text-xs text-gray-500 mt-1 bg-blue-50 p-2 rounded border border-blue-100">
              <strong>使用说明：</strong> 本应用现在使用 <code>/v1/chat/completions</code> 标准接口。<br/>
              请填写您的 New API 或 One API 域名，通常以 <code>/v1</code> 结尾。<br/>
              示例: <code>https://api.openai-proxy.com/v1</code><br/>
              (如果您忘记写 /v1，系统会自动尝试补全)
            </div>
          </div>

          <button
            type="submit"
            disabled={isValidating}
            className={`w-full py-3 rounded-lg text-white font-semibold shadow-md transition-all 
              ${isValidating ? 'bg-blue-400 cursor-wait' : 'bg-blue-600 hover:bg-blue-700 active:scale-95'}`}
          >
            {isValidating ? '验证并获取列表...' : '下一步'}
          </button>
        </form>
      ) : (
        <div className="space-y-4 animate-fadeIn flex flex-col min-h-0 flex-1">
          <div className="shrink-0">
            <div className="flex justify-between items-center mb-1">
               <label className="block text-sm font-medium text-gray-700">
                当前选择模型
              </label>
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
                {isTesting ? '...' : '测试单个'}
              </button>
            </div>
            <datalist id="model-options">
              {availableModels.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </datalist>
          </div>
          
          <div className="flex items-center justify-between shrink-0">
             <span className="text-xs text-gray-500">
               {availableModels.length > 0 ? `候选模型: ${availableModels.length} 个` : '使用默认列表'}
             </span>
             <button 
                type="button"
                onClick={handleTestAllModels}
                disabled={isTesting}
                className={`text-xs px-3 py-1 rounded-full border transition-all ${isTesting ? 'bg-gray-100 text-gray-400' : 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100'}`}
              >
                {isTesting ? '扫描中...' : '🔎 重新扫描所有模型'}
              </button>
          </div>

          {/* Models Status List */}
          <div ref={listRef} className="flex-1 min-h-[150px] overflow-y-auto border border-gray-100 rounded-lg bg-gray-50 p-2 text-xs">
                <p className="text-gray-400 mb-2 px-2 sticky top-0 bg-gray-50 pb-1 border-b border-gray-100 z-10">
                    连通性状态:
                </p>
                {availableModels.map((m) => (
                    <div 
                        key={m.id} 
                        onClick={() => setModel(m.id)}
                        className={`flex items-center justify-between p-2 rounded cursor-pointer border border-transparent hover:bg-white hover:shadow-sm transition-all mb-1
                            ${model === m.id ? 'bg-blue-50 border-blue-200 ring-1 ring-blue-100' : ''}
                            ${m.status === 'unavailable' ? 'opacity-60 grayscale' : ''}
                        `}
                    >
                        <div className="flex flex-col overflow-hidden">
                             <span className={`font-medium truncate ${m.status === 'available' ? 'text-gray-900' : 'text-gray-500'}`}>{m.name}</span>
                             <span className="text-[10px] text-gray-400 font-mono truncate">{m.id}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 pl-2">
                            {m.status === 'testing' && <span className="animate-spin w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full"></span>}
                            {m.status === 'available' && <span className="text-green-600 bg-green-50 px-2 py-0.5 rounded-full border border-green-100 flex items-center gap-1">OK <span className="text-[9px] opacity-70">| {m.latency}ms</span></span>}
                            {m.status === 'unavailable' && <span className="text-red-500 bg-red-50 px-2 py-0.5 rounded-full border border-red-100">Fail</span>}
                            {m.status === 'unknown' && <span className="text-gray-300 px-2">Wait</span>}
                        </div>
                    </div>
                ))}
          </div>

          {/* Messages */}
          <div className="shrink-0 space-y-2">
            {testResult && (
                <div className="p-3 bg-green-50 text-green-700 border border-green-200 text-sm rounded-lg flex items-center">
                <svg className="w-5 h-5 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
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
                返回修改
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