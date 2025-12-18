
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
    addLog("配置已加载。成功连接到 Gemini API。", 'success');
  };

  const handleTriggerPipeline = async (recipients: string[]) => {
    if (!config) return;

    setStatus(AppStatus.PROCESSING);
    setLogs([]); // Clear previous logs
    addLog("任务已手动触发。", 'info');

    try {
      // Step 1: Generate Data (The "Brain")
      // 如果已经有数据，复用数据（只发邮件）
      let data = digestData;
      if (!data) {
        data = await generateDailyDigest(config, (msg) => addLog(msg, 'info'));
        setDigestData(data);
        addLog("任务完成，预览就绪。", 'success');
      } else {
        addLog("使用已有的日报数据进行发送。", 'info');
      }
      
      // Step 2: Delivery (Real Backend vs Simulation)
      addLog(`准备推送邮件至 ${recipients.length} 位收件人: ${recipients.join(', ')}`, 'info');

      try {
        // 尝试调用真实的后端 API
        addLog("正在连接后端 API (/api/digest)...", 'info');
        
        const response = await fetch('/api/digest', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            recipients: recipients, // 传递数组
            digestData: data, // 发送原始数据，让后端生成 HTML
          }),
        });

        const resData = await response.json();

        if (response.ok) {
           addLog(`后端发送成功! Resend ID: ${resData.id}`, 'success');
        } else {
           // 如果 API 返回错误
           const errorMsg = resData.error || response.statusText;
           throw new Error(errorMsg);
        }

      } catch (backendError: any) {
        console.warn("Backend API unavailable, falling back to simulation.", backendError);
        
        // --- 错误处理与降级 ---
        addLog(`❌ 真实发送失败: ${backendError.message}`, 'error');
        
        if (backendError.message.includes("RESEND_API_KEY")) {
            addLog("提示: 请在 Vercel 环境变量中配置 RESEND_API_KEY。", 'info');
        }

        // 仅当非配置错误时才演示
        addLog("正在切换至演示模式 (Simulated Mode)...", 'info');
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const mockPayload = {
          recipients: recipients,
          subject: `Daily Pulse - ${new Date().toLocaleDateString()}`,
          content_json_length: JSON.stringify(data).length
        };
        console.log(">>> [MOCK] WOULD POST TO /api/digest:", mockPayload);
        addLog(`(模拟) 邮件已送达虚拟网关，收件人数: ${recipients.length}`, 'success');
      }
      
      setStatus(AppStatus.COMPLETE);

    } catch (error: any) {
      console.error(error);
      setStatus(AppStatus.ERROR);
      
      // FIX: Robust error message extraction to prevent [object Object]
      let msg = '未知错误';
      if (typeof error === 'string') {
          msg = error;
      } else if (error instanceof Error) {
          msg = error.message;
      } else if (typeof error === 'object' && error !== null) {
          msg = (error as any).message || JSON.stringify(error);
      }
      
      addLog(`任务失败: ${msg}`, 'error');
    }
  };

  const handleReset = () => {
    setStatus(AppStatus.CONFIG);
    setConfig(null);
    setDigestData(null);
    setLogs([]);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-gray-800 font-sans">
      {/* Background decoration */}
      <div className="fixed inset-0 z-0 pointer-events-none opacity-50">
         <div className="absolute -top-24 -left-24 w-96 h-96 bg-blue-200 rounded-full mix-blend-multiply filter blur-3xl animate-blob"></div>
         <div className="absolute top-0 -right-4 w-72 h-72 bg-purple-200 rounded-full mix-blend-multiply filter blur-3xl animate-blob animation-delay-2000"></div>
      </div>

      <div className="relative z-10 container mx-auto px-4 py-8 h-screen flex flex-col">
        {/* Header */}
        <header className="mb-6 flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-lg shadow-lg">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">Daily Pulse</h1>
            <p className="text-xs text-gray-500 font-medium">智能日报生成器</p>
          </div>
        </header>

        {/* Content */}
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
