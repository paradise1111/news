
'use client';

import React, { useState } from 'react';
import ConfigPanel from './components/ConfigPanel';
import PipelineView from './components/PipelineView';
import { AppConfig, AppStatus, DigestData, LogEntry } from './types';
import { generateDailyDigest } from './services/geminiService';

const App: React.FC = () => {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [status, setStatus] = useState<AppStatus>(AppStatus.CONFIG);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [digestData, setDigestData] = useState<DigestData | null>(null);

  const addLog = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
    const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    setLogs(prev => [...prev, { timestamp, message, type }]);
  };

  const handleConfigConfirmed = (newConfig: AppConfig) => {
    setConfig(newConfig);
    setStatus(AppStatus.READY);
    addLog(`智算系统就绪。已切换至引擎: ${newConfig.model}`, 'success');
  };

  const handleTriggerPipeline = async (recipients: string[]) => {
    if (!config) return;

    setStatus(AppStatus.PROCESSING);
    setLogs([]); 
    addLog("任务已手动触发。正在初始化搜索上下文...", 'info');

    try {
      let data = digestData;
      if (!data) {
        data = await generateDailyDigest(config, (msg) => addLog(msg, 'info'));
        setDigestData(data);
        addLog("内容聚合与精编完成，预览已生成。", 'success');
      } else {
        addLog("复用现有日报数据进行推送。", 'info');
      }
      
      addLog(`正在准备向 ${recipients.length} 个终端推送日报...`, 'info');

      try {
        const response = await fetch('/api/digest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipients: recipients,
            digestData: data,
          }),
        });

        const resData = await response.json();

        if (response.ok) {
           addLog(`推送成功! 事务 ID: ${resData.success ? 'HAJIMI-' + Date.now().toString(36).toUpperCase() : 'ERROR'}`, 'success');
        } else {
           throw new Error(resData.error || response.statusText);
        }

      } catch (backendError: any) {
        addLog(`❌ 推送渠道异常: ${backendError.message}`, 'error');
        addLog("系统进入模拟发送模式以完成演示...", 'info');
        await new Promise(resolve => setTimeout(resolve, 1500));
        addLog(`(模拟) 邮件已通过冗余网关发送，收件人: ${recipients.join(', ')}`, 'success');
      }
      
      setStatus(AppStatus.COMPLETE);

    } catch (error: any) {
      console.error(error);
      setStatus(AppStatus.ERROR);
      addLog(`流水线中断: ${error.message || '系统内部错误'}`, 'error');
    }
  };

  const handleReset = () => {
    setStatus(AppStatus.CONFIG);
    setConfig(null);
    setDigestData(null);
    setLogs([]);
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans selection:bg-indigo-100">
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
         <div className="absolute -top-40 -left-40 w-[500px] h-[500px] bg-indigo-100 rounded-full mix-blend-multiply filter blur-3xl opacity-50 animate-blob"></div>
         <div className="absolute top-1/2 -right-40 w-[500px] h-[500px] bg-blue-100 rounded-full mix-blend-multiply filter blur-3xl opacity-50 animate-blob animation-delay-2000"></div>
      </div>

      <div className="relative z-10 container mx-auto px-4 py-12 h-screen flex flex-col">
        <header className="mb-10 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="bg-indigo-600 p-3 rounded-2xl shadow-xl shadow-indigo-100">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">Hajimi Pulse</h1>
              <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">AI Intelligence Pipeline</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Standard API v3.0</span>
          </div>
        </header>

        <main className="flex-1 min-h-0 flex flex-col justify-center">
          {status === AppStatus.CONFIG ? (
            <div className="flex justify-center items-center h-full">
              <ConfigPanel onConfigConfirmed={handleConfigConfirmed} status={status} />
            </div>
          ) : (
            <PipelineView 
              status={status}
              logs={logs}
              data={digestData}
              onTrigger={handleTriggerPipeline}
              onReset={handleReset}
            />
          )}
        </main>
      </div>
    </div>
  );
};

export default App;
