
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
    { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro (深度精编)' },
    { id: 'gemini-2.5-flash-latest', name: 'Gemini 2.5 Flash' }
  ];

  const handleStart = () => {
    onConfigConfirmed({ 
        apiKey: '', // 环境变量中获取，此处传空
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
        <h2 className="text-3xl font-black text-gray-900 tracking-tight">Hajimi Intelligence</h2>
        <p className="text-gray-500 mt-2 font-medium">智能日报自动化生成系统</p>
      </div>

      <div className="space-y-6">
        <div>
          <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">选择智算引擎</label>
          <div className="grid grid-cols-1 gap-3">
            {models.map((m) => (
              <button
                key={m.id}
                onClick={() => setModel(m.id)}
                className={`flex items-center justify-between p-4 rounded-xl border-2 transition-all duration-200 ${
                  model === m.id 
                  ? 'border-indigo-600 bg-indigo-50 text-indigo-900' 
                  : 'border-gray-100 bg-gray-50 text-gray-500 hover:border-gray-200'
                }`}
              >
                <span className="font-bold">{m.name}</span>
                {model === m.id && (
                  <svg className="w-5 h-5 text-indigo-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
            <p className="text-xs text-blue-700 leading-relaxed font-medium">
              <strong>提示：</strong> 系统已自动接入安全密钥，您只需选择模型即可开始自动化资讯聚合与精编任务。
            </p>
        </div>

        <button
          onClick={handleStart}
          className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-black rounded-xl shadow-xl shadow-indigo-100 transition-all active:scale-95"
        >
          初始化并启动任务
        </button>
      </div>
    </div>
  );
};

export default ConfigPanel;
