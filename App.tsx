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
    
    // 如果已有数据，则跳过生成步骤直接发送（重新发送逻辑）
    let data = digestData;

    try {
      if (!data) {
        // Step 1: Generate Data (The "Brain")
        data = await generateDailyDigest(config, (msg) => addLog(msg, 'info'));
        setDigestData(data);
        addLog("任务完成，预览就绪。", 'success');
      } else {
        addLog("使用已生成的日报内容...", 'info');
      }
      
      // Step 2: Delivery (Real Backend vs Simulation)
      addLog(`准备推送邮件至 ${recipients.length} 位收件人: ${recipients.join(', ')}`, 'info');

      try {
        // 尝试调用真实的后端 API
        // 注意：这需要您部署了 Next.js 后端且配置了 Resend Key 才会成功
        addLog("正在连接后端 API (/api/digest)...", 'info');
        
        const response = await fetch('/api/digest', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            recipients: recipients, // Pass array of recipients
            digestData: data, // 发送原始数据，让后端生成 HTML
          }),
        });

        if (response.ok) {
           const resData = await response.json();
           addLog(`后端发送成功! ID: ${resData.id}`, 'success');
        } else {
           // 如果 API 返回 404 (未部署) 或 500 (配置错误)，抛出异常进入模拟流程
           const errData = await response.json().catch(() => ({}));
           throw new Error(`API 响应错误: ${response.status} ${errData.error || ''}`);
        }

      } catch (backendError: any) {
        console.warn("Backend API unavailable or failed, falling back to simulation.", backendError);
        // --- 降级方案：模拟演示 ---
        addLog(`注意：后端 API 连接失败 (${backendError.message})`, 'error');
        addLog("进入模拟模式 (仅前端演示)...", 'info');
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const mockPayload = {
          recipients: recipients,
          subject: `Daily Pulse - ${new Date().toLocaleDateString()}`,
          content_json_length: JSON.stringify(data).length
        };
        console.log(">>> [MOCK] WOULD POST TO /api/digest:", mockPayload);
        addLog(`(模拟) 邮件已送达 Resend 网关，目标: ${recipients.length} 人`, 'success');
      }
      
      setStatus(AppStatus.COMPLETE);

    } catch (error) {
      console.error(error);
      setStatus(AppStatus.ERROR);
      addLog(`任务失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
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