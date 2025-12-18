
import React, { useState, useEffect, useRef } from 'react';
import { DigestData, DigestItem, LogEntry, AppStatus } from '../types';

interface PipelineViewProps {
  status: AppStatus;
  logs: LogEntry[];
  data: DigestData | null;
  onTrigger: (emails: string[]) => void;
  onReset: () => void;
}

const PipelineView: React.FC<PipelineViewProps> = ({ status, logs, data, onTrigger, onReset }) => {
  const [activeTab, setActiveTab] = useState<'preview' | 'html'>('preview');
  const [emailInput, setEmailInput] = useState('');
  const [isTestingCron, setIsTestingCron] = useState(false);

  const logsEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const generateHtml = (data: DigestData) => {
    const renderItems = (items: DigestItem[], type: 'social' | 'health') => items.map((item, idx) => `
      <article class="bg-white rounded-none border-b-4 border-indigo-900 p-8 mb-8 relative overflow-hidden group hover:shadow-2xl transition-all duration-300">
        <div class="absolute top-0 right-0 w-64 h-64 bg-indigo-50 rounded-full blur-3xl opacity-50 -z-10 translate-x-1/3 -translate-y-1/3"></div>
        <div class="flex flex-col gap-4">
          <div class="flex items-center justify-between border-b border-gray-100 pb-4">
             <div class="flex items-center gap-3">
                <div class="bg-indigo-900 text-white font-mono text-xl font-bold px-4 py-2 shadow-[4px_4px_0px_#cbd5e1]">
                   ${item.ai_score}
                </div>
                <span class="font-serif text-indigo-900 font-bold text-sm tracking-widest border border-indigo-900 px-2 py-1">
                   ${item.ai_score_reason || '高热度'}
                </span>
             </div>
             <div class="text-gray-400 text-xs font-sans uppercase tracking-widest">
                NEWS / ${idx + 1 < 10 ? '0' + (idx + 1) : idx + 1}
             </div>
          </div>
          <h2 class="font-serif font-black text-3xl md:text-4xl text-gray-900 leading-tight mt-2">${item.title}</h2>
          ${item.xhs_titles && item.xhs_titles.length > 0 ? `
            <div class="bg-red-50 border-l-8 border-red-500 p-6 my-2 shadow-sm">
                <div class="flex items-center gap-2 mb-3 text-red-700 font-bold font-sans uppercase text-xs tracking-wider">RED NOTE Strategy</div>
                <ul class="space-y-2">
                    ${item.xhs_titles.map(t => `<li class="font-serif font-bold text-red-900 text-lg flex items-start gap-2">⚡ ${t}</li>`).join('')}
                </ul>
            </div>
          ` : ''}
          <div class="space-y-4 mt-2">
             <p class="font-serif font-bold text-lg text-gray-800 leading-relaxed text-justify border-l-2 border-indigo-200 pl-4">${item.summary_cn}</p>
             <p class="font-sans font-light text-sm text-gray-500 italic leading-relaxed pl-4">${item.summary_en}</p>
          </div>
          <div class="flex flex-wrap items-center justify-between pt-6 mt-4 border-t border-gray-100 gap-4">
             <div class="flex gap-2">
                ${(item.tags || []).map(t => `<span class="font-sans text-[10px] font-bold text-indigo-400 uppercase tracking-widest bg-indigo-50 px-2 py-1 rounded-sm">#${t}</span>`).join('')}
             </div>
             <a href="${item.source_url}" target="_blank" class="bg-gray-900 text-white font-sans font-bold text-xs px-6 py-3 uppercase tracking-widest hover:bg-indigo-600 transition-colors flex items-center gap-2">Read Source</a>
          </div>
        </div>
      </article>
    `).join('');

    return `
      <!DOCTYPE html>
      <html lang="zh-CN">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Hajimi Daily Digest</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@700;900&family=Poppins:wght@300;400;600&display=swap" rel="stylesheet">
        <style>
            body { background-color: #f1f5f9; }
            .font-serif { font-family: 'Noto Serif SC', serif; }
            .font-sans { font-family: 'Poppins', sans-serif; }
        </style>
      </head>
      <body class="antialiased text-gray-900 pb-20">
        <header class="bg-indigo-900 text-white py-20 px-4 mb-12 text-center">
                <div class="inline-block border-2 border-indigo-400 px-4 py-1 mb-4 font-sans text-xs tracking-[0.3em] text-indigo-300 uppercase">Daily Intelligence</div>
                <h1 class="font-serif font-black text-6xl md:text-8xl mb-4 tracking-tight">HAJIMI<span class="text-indigo-400">.</span>DAILY</h1>
                <p class="font-sans text-indigo-200 text-sm tracking-widest uppercase">${new Date().toLocaleDateString('zh-CN')} &bull; CURATED BY AI</p>
        </header>
        <main class="max-w-3xl mx-auto px-4">
            <div class="mb-16">${renderItems(data.social, 'social')}</div>
            <div class="mb-16">${renderItems(data.health, 'health')}</div>
            <footer class="text-center font-sans text-gray-400 text-xs tracking-widest uppercase border-t border-gray-200 pt-12">Generated by Hajimi Automation System</footer>
        </main>
      </body>
      </html>
    `;
  };

  const handleTestCron = async () => {
    setIsTestingCron(true);
    alert("正在尝试触发服务端 Cron 逻辑。请打开 Vercel 控制台查看 Runtime Logs。");
    try {
      const res = await fetch('/api/cron');
      const result = await res.json();
      if (res.ok) {
        alert("✅ 服务端执行成功！请检查邮箱。");
      } else {
        alert(`❌ 执行失败: ${result.error || result.message}\n请检查 Vercel 环境变量是否配置 (GEMINI_API_KEY, RESEND_API_KEY, RECIPIENTS)。`);
      }
    } catch (e: any) {
      alert("❌ 网络请求错误: " + e.message);
    } finally {
      setIsTestingCron(false);
    }
  };

  const isProcessing = status === AppStatus.PROCESSING;
  const isComplete = status === AppStatus.COMPLETE && data;

  const handleRun = () => {
    if (!emailInput) { alert("请输入接收邮箱"); return; }
    const recipients = emailInput.split(/[,;\s\n]+/).map(e => e.trim()).filter(e => e.length > 0);
    onTrigger(recipients);
  };

  return (
    <div className="flex flex-col h-full gap-6 relative">
      <div className="flex items-center justify-between bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex-wrap gap-4 z-10">
        <div className="flex items-center gap-4">
          <div className={`h-3 w-3 rounded-full ${isProcessing ? 'bg-yellow-400 animate-pulse' : isComplete ? 'bg-green-500' : 'bg-gray-300'}`} />
          <span className="font-medium text-gray-700">{isProcessing ? 'Processing...' : isComplete ? 'Done' : 'Ready'}</span>
        </div>
        <div className="flex gap-3 items-center ml-auto flex-wrap justify-end">
          <button 
            onClick={handleTestCron} 
            disabled={isTestingCron}
            className="text-xs text-orange-600 bg-orange-50 px-3 py-2 rounded-lg border border-orange-100 hover:bg-orange-100 transition-all font-bold"
          >
            {isTestingCron ? '测试中...' : '测试 Cron (Vercel)'}
          </button>
          <input type="text" placeholder="Email list..." value={emailInput} onChange={(e) => setEmailInput(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-48 focus:outline-none focus:border-indigo-500" disabled={isProcessing} />
          <button onClick={onReset} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm">Config</button>
          <button onClick={handleRun} disabled={isProcessing || !emailInput} className={`px-6 py-2 rounded-lg text-white font-semibold shadow-md ${isProcessing || !emailInput ? 'bg-gray-400' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
             {isProcessing ? 'Running...' : isComplete ? 'Resend' : 'Start'}
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 flex-1 min-h-0">
        <div className="lg:w-1/3 bg-gray-900 rounded-xl overflow-hidden flex flex-col shadow-lg border border-gray-800">
          <div className="bg-gray-800 px-4 py-2 flex justify-between font-mono text-[10px] text-gray-400 uppercase tracking-widest">
            <span>Terminal Output</span>
            <span className="text-indigo-400">Local Only</span>
          </div>
          <div className="flex-1 p-4 font-mono text-xs overflow-y-auto space-y-2 text-gray-300">
            {logs.map((log, idx) => <div key={idx} className={log.type === 'error' ? 'text-red-400' : log.type === 'success' ? 'text-green-400' : 'text-blue-300'}>[{log.timestamp}] {log.message}</div>)}
            <div ref={logsEndRef} />
          </div>
          <div className="p-3 border-t border-gray-800 bg-gray-900/50 text-[10px] text-gray-500 italic">
            注: 服务端 Cron 的日志请在 Vercel 控制台查看
          </div>
        </div>

        <div className="lg:w-2/3 bg-white rounded-xl shadow-lg border border-gray-100 flex flex-col overflow-hidden">
          {data ? (
            <>
              <div className="border-b border-gray-200 flex">
                <button onClick={() => setActiveTab('preview')} className={`px-6 py-3 text-sm font-medium ${activeTab === 'preview' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-500'}`}>Visual Preview</button>
                <button onClick={() => setActiveTab('html')} className={`px-6 py-3 text-sm font-medium ${activeTab === 'html' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-500'}`}>Source Code</button>
              </div>
              <div className="flex-1 overflow-y-auto bg-[#eef2f5] p-4">
                {activeTab === 'preview' ? (
                  <div className="max-w-full mx-auto bg-white shadow-xl min-h-[600px] flex justify-center">
                    <iframe title="Preview" srcDoc={generateHtml(data)} className="w-full h-[800px] border-none" sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts" />
                  </div>
                ) : (
                  <textarea readOnly className="w-full h-full p-4 font-mono text-xs bg-gray-50" value={generateHtml(data)} />
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-400 space-y-4">
                <svg className="w-16 h-16 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10l4 4v10a2 2 0 01-2 2z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M14 2v6h6" /></svg>
                <p className="text-sm">等待数据生成或触发任务...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PipelineView;
