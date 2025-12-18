
import React, { useState } from 'react';
import { AppConfig, AppStatus, ModelOption } from '../types';

interface ConfigPanelProps {
  onConfigConfirmed: (config: AppConfig) => void;
  status: AppStatus;
}

const ConfigPanel: React.FC<ConfigPanelProps> = ({ onConfigConfirmed }) => {
  const [model, setModel] = useState('gemini-3-flash-preview');

  const models: ModelOption[] = [
    { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash (极速搜索)' },
    { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro (深度精编)' }
  ];

  const handleStart = () => {
    // API Key 的处理完全交由后端/SDK 环境
    onConfigConfirmed({ 
        apiKey: '', 
        baseUrl: '', 
        model 
    });
  };

  return (
    <div className="max-w-md w-full bg-white rounded-2xl shadow-2xl p-8 border border-gray-100 animate-fadeIn">
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-indigo-200">
           <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
           </svg>
        </div>
        <h2 className="text-3xl font-black text-gray-900 tracking-tight">Hajimi Pulse</h2>
        <p className="text-gray-500 mt-1 font-medium italic">Powered by Gemini 3</p>
      </div>

      <div className="space-y-6">
        <div>
          <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">选择执行引擎</label>
          <div className="grid grid-cols-1 gap-3">
            {models.map((m) => (
              <button
                key={m.id}
                onClick={() => setModel(m.id)}
                className={`flex items-center justify-between p-4 rounded-xl border-2 transition-all duration-200 text-left ${
                  model === m.id 
                  ? 'border-indigo-600 bg-indigo-50 text-indigo-900 shadow-sm' 
                  : 'border-gray-100 bg-gray-50 text-gray-500 hover:border-gray-200'
                }`}
              >
                <div>
                    <div className="font-bold">{m.name}</div>
                    <div className="text-[10px] opacity-70 mt-1">
                        {m.id === 'gemini-3-flash-preview' ? '平衡速度与搜索接地能力' : '适合长文本逻辑精编'}
                    </div>
                </div>
                {model === m.id && (
                  <svg className="w-5 h-5 text-indigo-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-amber-50 p-4 rounded-xl border border-amber-100">
            <div className="flex gap-3">
                <svg className="w-5 h-5 text-amber-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-xs text-amber-800 leading-relaxed">
                  <strong>注意：</strong> 系统已自动载入托管密钥。如果出现“无可用渠道”错误，通常是该具体模型在当前配额下不可用，请尝试切换至 Flash 版本。
                </p>
            </div>
        </div>

        <button
          onClick={handleStart}
          className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-black rounded-xl shadow-xl shadow-indigo-100 transition-all active:scale-95 flex items-center justify-center gap-2"
        >
          <span>立即启动自动化流水线</span>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default ConfigPanel;
