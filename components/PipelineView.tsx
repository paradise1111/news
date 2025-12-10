import React, { useState, useEffect } from 'react';
import { DigestData, DigestItem, LogEntry, AppStatus } from '../types';
import { MOCK_EMAIL_STYLES } from '../constants';

interface PipelineViewProps {
  status: AppStatus;
  logs: LogEntry[];
  data: DigestData | null;
  onTrigger: (email: string) => void;
  onReset: () => void;
}

const PipelineView: React.FC<PipelineViewProps> = ({ status, logs, data, onTrigger, onReset }) => {
  const [activeTab, setActiveTab] = useState<'preview' | 'html'>('preview');
  const [email, setEmail] = useState('');

  // Auto-scroll logs
  const logsEndRef = React.useRef<HTMLDivElement>(null);
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const generateHtml = (data: DigestData) => {
    const renderItems = (items: DigestItem[]) => items.map(item => `
      <div style="${MOCK_EMAIL_STYLES.card}">
        <div style="${MOCK_EMAIL_STYLES.cardTitle}">${item.title}</div>
        <div style="${MOCK_EMAIL_STYLES.summaryEn}">${item.summary_en}</div>
        <div style="${MOCK_EMAIL_STYLES.summaryCn}">${item.summary_cn}</div>
        <div>
          <a href="${item.source_url}" style="${MOCK_EMAIL_STYLES.link}" target="_blank" rel="noopener noreferrer">阅读更多 (${item.source_name}) &rarr;</a>
        </div>
      </div>
    `).join('');

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <base target="_blank">
      </head>
      <body style="margin: 0; padding: 0; background-color: #f4f4f5;">
        <div style="${MOCK_EMAIL_STYLES.container}">
          <div style="${MOCK_EMAIL_STYLES.header}">
            <h1 style="margin:0; font-size: 24px;">Daily Pulse 日报</h1>
            <p style="margin: 5px 0 0 0; opacity: 0.9;">${new Date().toLocaleDateString()}</p>
          </div>
          
          <div style="${MOCK_EMAIL_STYLES.sectionTitle}">社交热点</div>
          ${renderItems(data.social)}
          
          <div style="${MOCK_EMAIL_STYLES.sectionTitle}">健康前沿</div>
          ${renderItems(data.health)}
          
          <div style="${MOCK_EMAIL_STYLES.footer}">
            由 Gemini 2.5 生成 • 自动资讯摘要
          </div>
        </div>
      </body>
      </html>
    `;
  };

  const isProcessing = status === AppStatus.PROCESSING;
  const isComplete = status === AppStatus.COMPLETE && data;

  const handleRun = () => {
    if (!email) {
      alert("请输入测试接收邮箱");
      return;
    }
    onTrigger(email);
  };

  return (
    <div className="flex flex-col h-full gap-6">
      
      {/* Control Bar */}
      <div className="flex items-center justify-between bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <div className={`h-3 w-3 rounded-full ${isProcessing ? 'bg-yellow-400 animate-pulse' : isComplete ? 'bg-green-500' : 'bg-gray-300'}`} />
          <span className="font-medium text-gray-700">
            {isProcessing ? '任务运行中...' : isComplete ? '日报已生成' : '准备就绪'}
          </span>
        </div>
        
        <div className="flex gap-3 items-center ml-auto">
          <input 
            type="email"
            placeholder="输入测试邮箱..."
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none w-48"
            disabled={isProcessing}
          />

          <button 
            onClick={onReset}
            className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors text-sm font-medium whitespace-nowrap"
          >
            返回配置
          </button>
          
          <button 
            onClick={handleRun}
            disabled={isProcessing || !email}
            className={`px-6 py-2 rounded-lg text-white font-semibold shadow-md transition-all flex items-center gap-2 whitespace-nowrap
              ${(isProcessing || !email)
                ? 'bg-gray-400 cursor-not-allowed' 
                : 'bg-indigo-600 hover:bg-indigo-700 active:scale-95'}`}
          >
             {isProcessing ? (
               <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                 <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                 <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
               </svg>
             ) : (
               <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
             )}
             {isComplete ? '重新生成' : '开始运行'}
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 flex-1 min-h-0">
        
        {/* Logs Console (The "Terminal") */}
        <div className="lg:w-1/3 bg-gray-900 rounded-xl overflow-hidden flex flex-col shadow-lg border border-gray-800">
          <div className="bg-gray-800 px-4 py-2 flex items-center justify-between">
            <span className="text-gray-400 text-xs font-mono">系统日志</span>
            <div className="flex gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/50"></div>
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/50"></div>
              <div className="w-2.5 h-2.5 rounded-full bg-green-500/50"></div>
            </div>
          </div>
          <div className="flex-1 p-4 font-mono text-xs overflow-y-auto space-y-2 text-gray-300">
            {logs.length === 0 && <span className="text-gray-600 italic">等待触发...</span>}
            {logs.map((log, idx) => (
              <div key={idx} className="flex gap-2">
                <span className="text-gray-500 shrink-0">[{log.timestamp}]</span>
                <span className={`${
                  log.type === 'error' ? 'text-red-400' : 
                  log.type === 'success' ? 'text-green-400' : 'text-blue-300'
                }`}>
                  {log.message}
                </span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>

        {/* Preview Area (The "Packaging") */}
        <div className="lg:w-2/3 bg-white rounded-xl shadow-lg border border-gray-100 flex flex-col overflow-hidden">
          {data ? (
            <>
              <div className="border-b border-gray-200 flex">
                <button 
                  onClick={() => setActiveTab('preview')}
                  className={`px-6 py-3 text-sm font-medium transition-colors ${activeTab === 'preview' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  邮件预览
                </button>
                <button 
                  onClick={() => setActiveTab('html')}
                  className={`px-6 py-3 text-sm font-medium transition-colors ${activeTab === 'html' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  HTML 源码
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto bg-gray-50 p-4">
                {activeTab === 'preview' ? (
                  <div className="max-w-[600px] mx-auto bg-white shadow-sm min-h-[500px]">
                    <iframe 
                      title="Preview"
                      srcDoc={generateHtml(data)}
                      className="w-full h-[600px] border-none"
                      sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
                    />
                  </div>
                ) : (
                  <div className="h-full relative">
                     <textarea 
                        readOnly
                        className="w-full h-full p-4 font-mono text-xs bg-gray-50 text-gray-700 border rounded resize-none focus:outline-none"
                        value={generateHtml(data)}
                      />
                      <button 
                        onClick={() => {navigator.clipboard.writeText(generateHtml(data)); alert('已复制到剪贴板!');}}
                        className="absolute top-4 right-4 bg-gray-800 text-white px-3 py-1 rounded text-xs hover:bg-gray-700"
                      >
                        复制代码
                      </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-400 p-8 text-center">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <p className="font-medium">暂无日报数据</p>
              <p className="text-sm mt-1">请输入测试邮箱并点击“开始运行”</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PipelineView;