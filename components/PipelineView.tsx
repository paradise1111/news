
import React, { useState, useEffect, useRef } from 'react';
import { DigestData, DigestItem, LogEntry, AppStatus } from '../types';

interface PipelineViewProps {
  status: AppStatus;
  logs: LogEntry[];
  data: DigestData | null;
  onTrigger: (emails: string[]) => void;
  onReset: () => void;
}

// HAND-DRAWN / SKETCH STYLE CSS CONSTANTS
const SKETCH_STYLES = {
  // Global Container
  container: "max-width: 640px; margin: 0 auto; background-color: #fdfbf7; color: #333333; font-family: 'Comic Sans MS', 'Chalkboard SE', sans-serif; padding: 20px;",
  
  // Header
  header: "text-align: center; margin-bottom: 30px; border-bottom: 2px dashed #bbb; padding-bottom: 20px;",
  headerTitle: "font-size: 32px; font-weight: bold; margin: 0; color: #4a4a4a; text-transform: uppercase; letter-spacing: 2px;",
  headerMeta: "font-family: monospace; color: #888; font-size: 14px; margin-top: 5px;",
  
  // Section Headers
  sectionContainer: "margin-bottom: 30px;",
  sectionTitle: "background-color: #333; color: #fff; padding: 8px 15px; font-size: 18px; font-weight: bold; display: inline-block; transform: rotate(-1deg); box-shadow: 3px 3px 0px rgba(0,0,0,0.2); margin-bottom: 15px; border-radius: 4px;",
  
  // Cards
  card: "background-color: #ffffff; border: 2px solid #333; border-radius: 8px; padding: 15px; margin-bottom: 15px; box-shadow: 4px 4px 0px #e0e0e0; position: relative;",
  
  // Card Content
  cardHeader: "display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;",
  cardTitle: "font-size: 18px; font-weight: bold; line-height: 1.3; margin: 0; flex: 1; color: #000;",
  scoreBadge: "background-color: #ffeb3b; border: 2px solid #333; font-weight: bold; font-family: monospace; padding: 2px 6px; font-size: 12px; border-radius: 4px; margin-left: 10px; box-shadow: 2px 2px 0px rgba(0,0,0,0.1);",
  
  tags: "margin-bottom: 10px; font-size: 12px; font-family: monospace;",
  tag: "background-color: #e0f7fa; padding: 2px 6px; border-radius: 4px; margin-right: 5px; border: 1px solid #b2ebf2; display: inline-block;",
  
  // Summary
  summary: "font-family: 'Verdana', sans-serif; font-size: 14px; line-height: 1.6; color: #444; margin-bottom: 12px;",
  summaryCn: "margin-bottom: 8px; font-weight: 500;",
  summaryEn: "color: #777; font-size: 0.9em; font-style: italic;",
  
  // Link
  link: "display: inline-block; background-color: #333; color: #fff; text-decoration: none; padding: 6px 12px; font-size: 12px; font-weight: bold; border-radius: 4px; transition: opacity 0.2s;",
  
  footer: "text-align: center; font-size: 12px; color: #aaa; margin-top: 40px; border-top: 1px solid #ddd; padding-top: 20px; font-family: monospace;"
};

const PipelineView: React.FC<PipelineViewProps> = ({ status, logs, data, onTrigger, onReset }) => {
  const [activeTab, setActiveTab] = useState<'preview' | 'html'>('preview');
  const [emailInput, setEmailInput] = useState('');
  const [showInfo, setShowInfo] = useState(false);

  const logsEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const generateHtml = (data: DigestData) => {
    const renderItems = (items: DigestItem[]) => items.map(item => `
      <div style="${SKETCH_STYLES.card}">
        <div style="${SKETCH_STYLES.cardHeader}">
           <div style="${SKETCH_STYLES.cardTitle}">${item.title}</div>
           <div style="${SKETCH_STYLES.scoreBadge}">${item.ai_score}</div>
        </div>
        
        <div style="${SKETCH_STYLES.tags}">
          ${(item.tags || []).map(tag => `<span style="${SKETCH_STYLES.tag}">${tag}</span>`).join('')}
          <span style="color:#999; margin-left:5px;">@${item.source_name}</span>
        </div>

        <div style="${SKETCH_STYLES.summary}">
           <div style="${SKETCH_STYLES.summaryCn}">💡 ${item.summary_cn}</div>
           <div style="${SKETCH_STYLES.summaryEn}">${item.summary_en}</div>
        </div>
        
        <div>
          <a href="${item.source_url}" target="_blank" style="${SKETCH_STYLES.link}">🔗 READ SOURCE &rarr;</a>
        </div>
      </div>
    `).join('');

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <!-- Google Fonts for that 'Report' feel -->
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Patrick+Hand&family=ZCOOL+KuaiLe&display=swap" rel="stylesheet">
        <title>Hajimi Morning Report</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #eef2f5;">
        <div style="${SKETCH_STYLES.container}">
          <div style="${SKETCH_STYLES.header}">
            <h1 style="${SKETCH_STYLES.headerTitle}">📝 HAJIMI MORNING REPORT</h1>
            <div style="${SKETCH_STYLES.headerMeta}">
               📅 ${new Date().toLocaleDateString('zh-CN')} | 🤖 AI GENERATED
            </div>
          </div>
          
          <div style="${SKETCH_STYLES.sectionContainer}">
             <div style="${SKETCH_STYLES.sectionTitle}">🔥 TRENDS & CULTURE</div>
             ${renderItems(data.social)}
          </div>
          
          <div style="${SKETCH_STYLES.sectionContainer}">
             <div style="${SKETCH_STYLES.sectionTitle} background-color: #27ae60;">🧬 HEALTH & SCIENCE</div>
             ${renderItems(data.health)}
          </div>
          
          <div style="${SKETCH_STYLES.footer}">
            GENERATED BY 哈基米 AUTOMATION
          </div>
        </div>
      </body>
      </html>
    `;
  };

  const handleDownloadLogs = () => {
    if (logs.length === 0) return;
    const content = logs.map(l => `[${l.timestamp}] [${l.type.toUpperCase()}] ${l.message}`).join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hajimi-logs-${new Date().toISOString().slice(0,10)}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const isProcessing = status === AppStatus.PROCESSING;
  const isComplete = status === AppStatus.COMPLETE && data;

  const handleRun = () => {
    if (!emailInput) { alert("请输入接收邮箱"); return; }
    const recipients = emailInput.split(/[,;\s\n]+/).map(e => e.trim()).filter(e => e.length > 0);
    if (recipients.length === 0) { alert("请输入有效的邮箱地址"); return; }
    onTrigger(recipients);
  };

  return (
    <div className="flex flex-col h-full gap-6 relative">
      {/* Control Bar */}
      <div className="flex items-center justify-between bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex-wrap gap-4 z-10">
        <div className="flex items-center gap-4">
          <div className={`h-3 w-3 rounded-full ${isProcessing ? 'bg-yellow-400 animate-pulse' : isComplete ? 'bg-green-500' : 'bg-gray-300'}`} />
          <span className="font-medium text-gray-700">{isProcessing ? 'Working...' : isComplete ? 'Done' : 'Ready'}</span>
        </div>
        <div className="flex gap-3 items-center ml-auto flex-wrap justify-end">
          <button onClick={() => setShowInfo(true)} className="text-gray-500 hover:text-indigo-600 transition-colors text-sm font-medium mr-2">Using Gemini 2.5</button>
          <input type="text" placeholder="Email list..." value={emailInput} onChange={(e) => setEmailInput(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-64 focus:outline-none focus:border-indigo-500" disabled={isProcessing} />
          <button onClick={onReset} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm">Config</button>
          <button onClick={handleRun} disabled={isProcessing || !emailInput} className={`px-6 py-2 rounded-lg text-white font-semibold shadow-md ${isProcessing || !emailInput ? 'bg-gray-400' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
             {isProcessing ? 'Running...' : isComplete ? 'Resend' : 'Start'}
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 flex-1 min-h-0">
        {/* Logs */}
        <div className="lg:w-1/3 bg-gray-900 rounded-xl overflow-hidden flex flex-col shadow-lg border border-gray-800">
          <div className="bg-gray-800 px-4 py-2 flex justify-between"><span className="text-gray-400 text-xs">TERMINAL</span><button onClick={handleDownloadLogs} className="text-gray-400 hover:text-white">⬇</button></div>
          <div className="flex-1 p-4 font-mono text-xs overflow-y-auto space-y-2 text-gray-300">
            {logs.map((log, idx) => <div key={idx} className={log.type === 'error' ? 'text-red-400' : log.type === 'success' ? 'text-green-400' : 'text-blue-300'}>[{log.timestamp}] {log.message}</div>)}
            <div ref={logsEndRef} />
          </div>
        </div>

        {/* Preview */}
        <div className="lg:w-2/3 bg-white rounded-xl shadow-lg border border-gray-100 flex flex-col overflow-hidden">
          {data ? (
            <>
              <div className="border-b border-gray-200 flex">
                <button onClick={() => setActiveTab('preview')} className={`px-6 py-3 text-sm font-medium ${activeTab === 'preview' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-500'}`}>Visual Preview</button>
                <button onClick={() => setActiveTab('html')} className={`px-6 py-3 text-sm font-medium ${activeTab === 'html' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-500'}`}>Source Code</button>
              </div>
              <div className="flex-1 overflow-y-auto bg-[#eef2f5] p-4">
                {activeTab === 'preview' ? (
                  <div className="max-w-[640px] mx-auto bg-white shadow-xl min-h-[600px]">
                    <iframe title="Preview" srcDoc={generateHtml(data)} className="w-full h-[800px] border-none" sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts" />
                  </div>
                ) : (
                  <textarea readOnly className="w-full h-full p-4 font-mono text-xs bg-gray-50" value={generateHtml(data)} />
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-400"><p>Waiting for data...</p></div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PipelineView;
