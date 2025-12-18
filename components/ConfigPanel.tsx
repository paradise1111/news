
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
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  
  const [step, setStep] = useState<'credentials' | 'model'>('credentials');
  const [isValidating, setIsValidating] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  
  const listRef = useRef<HTMLDivElement>(null);

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
      const models = await verifyAndFetchModels(apiKey, baseUrl);
      
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ apiKey, baseUrl }));

      if (models && models.length > 0) {
        setAvailableModels(models);
        setModel(models[0].id);
        setStep('model');
      } else {
        setError("API 连接成功但未返回任何模型。请检查后台是否有模型权限。");
        setAvailableModels(DEFAULT_MODELS.map(m => ({ ...m, status: 'unknown' } as ModelOption)));
        setModel(DEFAULT_MODELS[0].id);
        setStep('model');
      }
    } catch (err: any) {
      console.warn("Connection error:", err);
      // 展示真实错误：例如 "Invalid API Key" 或 "404 Not Found"
      setError(`连接失败: ${err.message || '未知网络错误'}`);
      
      // 仍然允许进入下一步，方便用户手动指定模型调试
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
      setError(`模型不可用: ${result.error}`);
    }
    setIsTesting(false);
  };

  const handleTestAllModels = async () => {
    setIsTesting(true);
    setTestResult(null);
    setError(null);
    const updatedModels = [...availableModels];
    let successCount = 0;
    
    for(let i=0; i<updatedModels.length; i++) {
        updatedModels[i].status = 'unknown';
    }
    setAvailableModels([...updatedModels]);

    for (let i = 0; i < updatedModels.length; i++) {
      updatedModels[i] = { ...updatedModels[i], status: 'testing' };
      setAvailableModels([...updatedModels]);
      
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
          if (successCount === 1) setModel(updatedModels[i].id);
      }
      setAvailableModels([...updatedModels]);
      await new Promise(r => setTimeout(r, 100));
    }
    
    setIsTesting(false);
    if (successCount === 0) {
        setError("扫描完成：所有模型均无法连接，请确认 API Key 是否有权限或 Base URL 正确。");
    } else {
        setTestResult(`扫描完成：发现 ${successCount} 个可用模型。`);
    }
  };

  const handleStart = (e: React.FormEvent) => {
    e.preventDefault();
    if (!model) {
      setError("请选择一个模型。");
      return;
    }
    onConfigConfirmed({ apiKey, baseUrl, model });
  };

  return (
    <div className="max-w-xl w-full bg-white rounded-xl shadow-2xl p-8 border border-gray-100 relative overflow-hidden flex flex-col max-h-[90vh]">
      <div className="text-center mb-6 shrink-0">
        <h2 className="text-2xl font-bold text-gray-800">Daily Pulse Setup</h2>
        <p className="text-gray-500 text-sm mt-2">
          {step === 'credentials' ? '配置 API 令牌 (兼容 OneAPI / OpenAI / New API)' : '选择可用的模型'}
        </p>
      </div>

      {step === 'credentials' ? (
        <form onSubmit={handleConnect} className="space-y-6 animate-fadeIn overflow-y-auto p-1">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">令牌 (API Key / Token)</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">接口地址 (Base URL)</label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="例如: https://api.domain.com/v1"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
            />
            <div className="text-xs text-gray-500 mt-2 bg-gray-50 p-3 rounded border border-gray-200 leading-relaxed">
              <strong>💡 提示：</strong> 系统会自动处理 <code>/v1</code>。请确保你的 API 支持 <code>/v1/models</code> 标准接口。
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-50 text-red-700 border border-red-200 text-xs rounded-lg flex items-start">
              <span className="mr-2 mt-0.5">⚠️</span> {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isValidating}
            className={`w-full py-3 rounded-lg text-white font-semibold shadow-md transition-all 
              ${isValidating ? 'bg-blue-400 cursor-wait' : 'bg-blue-600 hover:bg-blue-700 active:scale-95'}`}
          >
            {isValidating ? '正在建立连接...' : '连接并获取模型'}
          </button>
        </form>
      ) : (
        <div className="space-y-4 animate-fadeIn flex flex-col min-h-0 flex-1">
          <div className="shrink-0">
            <label className="block text-sm font-medium text-gray-700 mb-1">当前选择模型</label>
            <div className="flex gap-2">
              <input
                list="model-options"
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
              />
               <button
                type="button"
                onClick={handleTestSingleModel}
                disabled={isTesting || !model}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium text-sm border border-gray-200"
              >
                {isTesting ? '...' : '测试'}
              </button>
            </div>
            <datalist id="model-options">
              {availableModels.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </datalist>
          </div>
          
          <div className="flex items-center justify-between shrink-0">
             <span className="text-xs text-indigo-600 font-bold uppercase tracking-wider">
               发现 {availableModels.length} 个模型
             </span>
             <button 
                type="button"
                onClick={handleTestAllModels}
                disabled={isTesting}
                className="text-xs px-3 py-1 rounded-full border bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100 transition-all"
              >
                {isTesting ? '正在验证...' : '🔍 一键测速'}
              </button>
          </div>

          <div ref={listRef} className="flex-1 min-h-[150px] overflow-y-auto border border-gray-100 rounded-lg bg-gray-50 p-2 text-xs">
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
                        </div>
                        <div className="flex items-center gap-2 shrink-0 pl-2">
                            {m.status === 'testing' && <span className="animate-spin w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full"></span>}
                            {m.status === 'available' && <span className="text-green-600 font-bold">{m.latency}ms</span>}
                            {m.status === 'unavailable' && <span className="text-red-500">不可用</span>}
                        </div>
                    </div>
                ))}
          </div>

          <div className="shrink-0 space-y-2">
            {testResult && <div className="p-3 bg-green-50 text-green-700 border border-green-200 text-sm rounded-lg">{testResult}</div>}
            {error && <div className="p-3 bg-red-50 text-red-700 border border-red-200 text-xs rounded-lg">{error}</div>}

            <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setStep('credentials')} className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-lg transition-colors">修改配置</button>
                <button type="button" onClick={handleStart} className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg shadow-md transition-all active:scale-95">进入日报系统</button>
            </div>
          </div>
        </div>
      )}
      
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeIn { animation: fadeIn 0.3s ease-out forwards; }
      `}</style>
    </div>
  );
};

export default ConfigPanel;
