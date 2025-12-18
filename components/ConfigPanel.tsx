
import React, { useState, useEffect, useRef } from 'react';
import { AppConfig, AppStatus, ModelOption } from '../types';
import { DEFAULT_MODELS } from '../constants';
import { verifyAndFetchModels, checkModelAvailability } from '../services/geminiService';

interface ConfigPanelProps {
  onConfigConfirmed: (config: AppConfig) => void;
  status: AppStatus;
}

const ConfigPanel: React.FC<ConfigPanelProps> = ({ onConfigConfirmed, status }) => {
  const [model, setModel] = useState(DEFAULT_MODELS[0].id);
  const [availableModels, setAvailableModels] = useState<ModelOption[]>(DEFAULT_MODELS.map(m => ({ ...m, status: 'unknown' } as ModelOption)));
  
  const [isTesting, setIsTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loadModels = async () => {
      const models = await verifyAndFetchModels();
      setAvailableModels(models);
    };
    loadModels();
  }, []);

  const handleTestSingleModel = async () => {
    if (!model) return;
    setIsTesting(true);
    setTestResult(null);
    setError(null);
    
    const result = await checkModelAvailability(model);
    
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

      const result = await checkModelAvailability(updatedModels[i].id);
      
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
        setError("所有模型均不可用。请确保系统 API_KEY 已正确配置。");
    } else {
        setTestResult(`测试完成。共发现 ${successCount} 个可用模型。`);
    }
  };

  const handleStart = (e: React.FormEvent) => {
    e.preventDefault();
    if (!model) {
      setError("请选择一个模型。");
      return;
    }
    const config: AppConfig = { model };
    onConfigConfirmed(config);
  };

  return (
    <div className="max-w-xl w-full bg-white rounded-xl shadow-2xl p-8 border border-gray-100 relative overflow-hidden flex flex-col max-h-[90vh]">
      <div className="text-center mb-6 shrink-0">
        <h2 className="text-2xl font-bold text-gray-800">Daily Pulse Setup</h2>
        <p className="text-gray-500 text-sm mt-2">选择模型并开始生成日报</p>
      </div>

      <div className="space-y-4 animate-fadeIn flex flex-col min-h-0 flex-1">
        <div className="shrink-0">
          <label className="block text-sm font-medium text-gray-700 mb-2">当前选择模型</label>
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
             可用模型: {availableModels.length} 个
           </span>
           <button 
              type="button"
              onClick={handleTestAllModels}
              disabled={isTesting}
              className={`text-xs px-3 py-1 rounded-full border transition-all ${isTesting ? 'bg-gray-100 text-gray-400' : 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100'}`}
            >
              {isTesting ? '扫描中...' : '🔎 连通性测试'}
            </button>
        </div>

        <div ref={listRef} className="flex-1 min-h-[150px] overflow-y-auto border border-gray-100 rounded-lg bg-gray-50 p-2 text-xs">
              <p className="text-gray-400 mb-2 px-2 sticky top-0 bg-gray-50 pb-1 border-b border-gray-100 z-10">连通性状态:</p>
              {availableModels.map((m) => (
                  <div 
                      key={m.id} 
                      onClick={() => setModel(m.id)}
                      className={`flex items-center justify-between p-2 rounded cursor-pointer border border-transparent hover:bg-white hover:shadow-sm transition-all mb-1
                          ${model === m.id ? 'bg-blue-50 border-blue-200 ring-1 ring-blue-100' : ''}
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
                      </div>
                  </div>
              ))}
        </div>

        <div className="shrink-0 space-y-2">
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

          <button
            type="button"
            onClick={handleStart}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg shadow-md transition-all active:scale-95"
          >
            启动任务
          </button>
        </div>
      </div>
      
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