import React, { useState, useEffect, useRef } from 'react';
import { Send, Bot, MonitorPlay, Sparkles, ChevronLeft, MousePointer2, Globe } from 'lucide-react';
import { decideNextAction } from './lib/gemini';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

export default function App() {
  const [view, setView] = useState<'chat' | 'preview'>('chat');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [aiPrompt, setAiPrompt] = useState("");
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiActiveTarget, setAiActiveTarget] = useState<{agentId: string} | null>(null);

  // Browser state
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [browserScreenshot, setBrowserScreenshot] = useState<string>("");
  const [browserHtml, setBrowserHtml] = useState<string>("");
  const [urlInput, setUrlInput] = useState<string>("http://localhost:3000/start-page");
  const [isLoadingUrl, setIsLoadingUrl] = useState(false);
  const [keyboardInput, setKeyboardInput] = useState<string>("");
  const [inputRects, setInputRects] = useState<{x: number, y: number, w: number, h: number, val: string}[]>([]);
  const [remoteSize, setRemoteSize] = useState({ w: 1280, h: 800 });

  // Login Modal State
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const hiddenInputRef = useRef<HTMLInputElement>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Using a ref for state data to use inside the looping async function
  const htmlRef = useRef(browserHtml);
  
  useEffect(() => {
    htmlRef.current = browserHtml;
  }, [browserHtml]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatMessages, isAiLoading]);

  // Init Browser Session
  useEffect(() => {
    const initBrowser = async () => {
      try {
        const browserWidth = Math.min(1280, window.innerWidth);
        const browserHeight = Math.min(800, window.innerHeight - 60 - 56); // 60px header, 56px url bar
        const res = await fetch('/api/browser/init', { 
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ width: browserWidth, height: browserHeight })
        });
        const data = await res.json();
        if (data.sessionId) {
          setSessionId(data.sessionId);
          // Initial Navigation
          handleAction(data.sessionId, 'NAVIGATE', { url: "http://localhost:3000/start-page" });
        }
      } catch (err) {
        console.error("Failed to init browser", err);
      }
    };
    initBrowser();
  }, []);

  const wsRef = useRef<WebSocket | null>(null);

  // WebSockets for Live Screencast
  useEffect(() => {
    if (!sessionId) return;
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/browser/stream?sessionId=${sessionId}`);
    wsRef.current = ws;
    
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'screencastFrame') {
          // message.data is base64 JPEG
          setBrowserScreenshot(message.data);
        } else if (message.type === 'urlChanged') {
          setUrlInput(message.url);
        } else if (message.type === 'inputRects') {
          setInputRects(message.rects || []);
        }
      } catch (err) {}
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [sessionId]);

  const fetchState = async (sid: string) => {
    try {
      const res = await fetch('/api/browser/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sid })
      });
      const data = await res.json();
      if (data.success && data.state) {
        // No need to set the screenshot here as WS streams it live, 
        // but it doesn't hurt. We'll skip it to avoid flickering.
        setBrowserHtml(data.state.html);
        if (data.state.url) setUrlInput(data.state.url);
        return data.state.html as string;
      }
    } catch(e) { }
    return "";
  };

  const handleAction = async (sid: string, action: string, params: any) => {
    setIsLoadingUrl(true);
    let newHtml = "";
    try {
      const res = await fetch('/api/browser/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sid, action, params })
      });
      const data = await res.json();
      if (data.success && data.state) {
        setBrowserHtml(data.state.html);
        if (data.state.url) setUrlInput(data.state.url);
        newHtml = data.state.html;
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingUrl(false);
    }
    return newHtml;
  };

  const handleURLSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isAiLoading) return;
    if (sessionId && urlInput) {
      await handleAction(sessionId, 'NAVIGATE', { url: urlInput });
    }
  };

  const handleAiSubmit = async () => {
    if (!aiPrompt.trim() || isAiLoading || !sessionId) return;
    
    const userMsg = aiPrompt.trim();
    setAiPrompt("");
    setChatMessages(prev => [...prev, { id: Date.now().toString(), role: 'user', content: userMsg }]);
    setIsAiLoading(true);
    
    try {
      // Her yeni mesajda sayfanın en güncel HTML durumunu çekiyoruz.
      let currentHtml = await fetchState(sessionId);

      // Reconing Loop
      const maxSteps = 15;
      let step = 0;
      let isFinished = false;
      let actionHistory: string[] = [];

      while (step < maxSteps && !isFinished) {
        step++;
        
        let contextInfo = "Ekrandaki Tıklanabilir Öğeler (Sadeleştirilmiş HTML):\n\n";
        if (currentHtml) {
          contextInfo += currentHtml.slice(0, 30000); // Prevent overflow for API limits
        } else {
          contextInfo += "(Şu anda açık bir sayfa yok veya sayfa yüklenmedi.)\n";
        }
        
        if (actionHistory.length > 0) {
          contextInfo += "\n\n--- GEÇMİŞ İŞLEMLER (Bu görevde şu ana kadar yaptıkların) ---\n";
          actionHistory.forEach((h, i) => contextInfo += `${i+1}. ${h}\n`);
          contextInfo += "\nLütfen Geçmiş İşlemlerine bak. Eğer kullanıcının tam olarak istediğini zaten yaptıysan (örneğin sadece 1 tıklama istenmişse ve tıkladıysan, ya da metin girmen istendiyse ve girdiysen), AYNI YERİ TEKRAR DENEME ve isTaskComplete: true döndürerek DUR.\n";
        }

        const agentResponse = await decideNextAction(userMsg, contextInfo);
        
        actionHistory.push(`Eylem: ${agentResponse.action}, Detay: ${JSON.stringify(agentResponse.params)}, Sistem Açıklaması: "${agentResponse.thought}"`);

        if (agentResponse.action === 'FINISH') {
          isFinished = true;
          setChatMessages(prev => [...prev, { 
            id: Date.now().toString() + Math.random(), 
            role: 'assistant', 
            content: `Görev başarıyla tamamlandı!\n\nSon İşlem Özeti: ${agentResponse.thought}` 
          }]);
          break;
        }

        // Execute action
        setView('preview');
        if (agentResponse.params && agentResponse.params.agentId) {
          setAiActiveTarget({ agentId: agentResponse.params.agentId });
        }
        
        currentHtml = await handleAction(sessionId, agentResponse.action, agentResponse.params);
        setAiActiveTarget(null);
        
        if (agentResponse.isTaskComplete) {
          isFinished = true;
          setChatMessages(prev => [...prev, { 
            id: Date.now().toString() + Math.random(), 
            role: 'assistant', 
            content: `Görev başarıyla tamamlandı!\n\nSon İşlem Özeti: ${agentResponse.thought}` 
          }]);
          break;
        }
        
        // Wait 20 seconds to prevent 429 Too Many Requests
        await new Promise(r => setTimeout(r, 20000));
      }

      if (!isFinished) {
        setChatMessages(prev => [...prev, { 
          id: Date.now().toString() + Math.random(), 
          role: 'assistant', 
          content: "15 adımlık limite ulaşıldı, görev tam olarak bitirilemeden durduruldu." 
        }]);
      }
      
      setView('chat');

    } catch (error) {
      setChatMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', content: "Bir hata oluştu: " + String(error) }]);
    } finally {
      setIsAiLoading(false);
    }
  };

  return (
    <div className="w-[100vw] h-[100dvh] bg-[#0A0A0A] text-slate-200 flex flex-col font-sans overflow-hidden fixed inset-0">
      
      {/* ---------- HEADER ---------- */}
      <header className="h-[60px] shrink-0 border-b border-white/10 flex items-center justify-between px-4 lg:px-6 relative z-20">
        <button 
          onClick={() => setView(view === 'chat' ? 'preview' : 'chat')} 
          className="bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-2 lg:px-4 rounded-lg text-xs lg:text-sm font-medium flex flex-row items-center gap-2 transition-colors active:scale-95"
        >
          {view === 'chat' ? (
             <>
               <MonitorPlay className="w-4 h-4 text-indigo-400" />
               <span className="hidden sm:inline text-indigo-200">Yapay Tıklama Önizlemesi</span>
               <span className="sm:hidden text-indigo-200">Önizleme</span>
             </>
          ) : (
             <>
               <ChevronLeft className="w-4 h-4" />
               <span>Sohbete Dön</span>
             </>
          )}
        </button>
        
        <div className="flex items-center gap-2 font-black text-base tracking-wide text-white">
           <Bot className="w-5 h-5 text-indigo-400" />
          Otobot AI
        </div>
      </header>

      {/* ---------- MAIN AREA ---------- */}
      <main className="flex-1 relative overflow-hidden flex w-full h-[calc(100vh-60px)]">
          
          {/* SCREENSHOT PREVIEW CONTAINER */}
          <div className={`absolute inset-0 flex items-center justify-center bg-[#000000] p-0 transition-opacity duration-500 ease-in-out ${view === 'preview' ? 'opacity-100 z-10' : 'opacity-0 pointer-events-none z-0'}`}>
              <div className="w-full h-full mx-auto bg-[#1C1C1E] flex flex-col border-none overflow-hidden relative">
                 {/* Modern Browser Tab / Address Bar (Chrome Dark style) */}
                 <div className="bg-[#202124] flex flex-col shrink-0">
                   {/* Tabs Area */}
                   <div className="flex items-end px-2 pt-2 gap-1 h-10 border-b border-[#000]">
                     <div className="flex items-center justify-between bg-[#323639] w-48 sm:w-60 h-8 rounded-t-lg px-3 group">
                       <div className="flex items-center gap-2 overflow-hidden mix-blend-plus-lighter">
                         <div className="w-4 h-4 bg-white/20 rounded-full flex items-center justify-center shrink-0">
                            <Globe className="w-2.5 h-2.5 text-white" />
                         </div>
                         <span className="text-xs font-medium text-slate-200 truncate">{urlInput || "Yeni Sekme"}</span>
                       </div>
                     </div>
                     <div className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors mb-0.5 ml-1">
                       <div className="text-white/70 text-lg font-light leading-none">+</div>
                     </div>
                   </div>
                   
                   {/* Address Bar Area */}
                   <div className="h-12 bg-[#323639] border-b border-[#000] flex items-center px-3 sm:px-4 gap-3">
                     
                     <div className="flex items-center gap-1.5 text-[#E8EAED]">
                       <div className="w-7 h-7 rounded-full hover:bg-white/10 flex items-center justify-center cursor-pointer transition-colors">
                         <ChevronLeft className="w-4 h-4" />
                       </div>
                       <div className="w-7 h-7 rounded-full hover:bg-white/10 flex items-center justify-center cursor-pointer transition-colors">
                         <ChevronLeft className="w-4 h-4 rotate-180" />
                       </div>
                       <div className="w-7 h-7 rounded-full hover:bg-white/10 flex items-center justify-center cursor-pointer transition-colors ml-1">
                         <div className="w-3.5 h-3.5 border-2 border-current border-r-transparent rounded-full" style={{ transform: 'rotate(45deg)' }}></div>
                       </div>
                     </div>
                     
                     <form onSubmit={handleURLSubmit} className="flex-1 flex items-center justify-center">
                       <div className="w-full relative flex items-center">
                         <input 
                            type="text" 
                            value={urlInput}
                            onChange={(e) => setUrlInput(e.target.value)}
                            disabled={isAiLoading}
                            className="w-full bg-[#202124] border border-transparent focus:border-[#8AB4F8] outline-none rounded-full text-[#E8EAED] px-5 py-1.5 text-sm transition-all disabled:opacity-50"
                            spellCheck="false"
                         />
                         {isLoadingUrl && (
                           <div className="absolute right-3 flex items-center h-full">
                             <div className="w-3.5 h-3.5 border-2 border-[#8AB4F8] border-t-transparent rounded-full animate-spin"></div>
                           </div>
                         )}
                       </div>
                     </form>
                     
                     <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                             if (!sessionId || isAiLoading) return;
                             setShowLoginModal(true);
                          }}
                          disabled={isAiLoading}
                          className="px-3 py-1.5 bg-[#8AB4F8]/10 hover:bg-[#8AB4F8]/20 text-[#8AB4F8] text-[11px] sm:text-xs font-medium rounded transition-colors whitespace-nowrap disabled:opacity-50"
                        >
                          Giriş Yap
                        </button>
                        <div className="w-7 h-7 rounded-full hover:bg-white/10 hidden sm:flex items-center justify-center">
                          <Bot className="w-4 h-4 text-[#8AB4F8]" />
                        </div>
                     </div>
                   </div>
                 </div>
                 
                 {/* Browser Viewport */}
                 <div className="flex-1 relative overflow-hidden bg-white flex items-center justify-center"
                      tabIndex={0}
                      onKeyDown={(e) => {
                         if (isAiLoading || !wsRef.current) return;
                         e.preventDefault();
                         wsRef.current.send(JSON.stringify({ type: 'keydown', key: e.key }));
                      }}
                 >
                    {isAiLoading && (
                       <div className="absolute inset-0 z-20 bg-black/10 cursor-not-allowed"></div>
                    )}
                    {browserScreenshot ? (
                       <div className="relative inline-block w-full h-[auto] shadow-2xl rounded-sm ring-1 ring-white/10" style={{ cursor: isAiLoading ? 'wait' : 'crosshair' }}>
                           <img 
                             src={`data:image/jpeg;base64,${browserScreenshot}`} 
                             className="w-full h-auto block rounded-sm pointer-events-auto" 
                             alt="Browser View" 
                             onLoad={(e) => {
                                 setRemoteSize({ 
                                     w: e.currentTarget.naturalWidth || 1280, 
                                     h: e.currentTarget.naturalHeight || 800 
                                 });
                             }}
                             onDragStart={(e) => e.preventDefault()}
                         onMouseDown={(e) => {
                            if (isAiLoading || !wsRef.current) return;
                            const rect = e.currentTarget.getBoundingClientRect();
                            const img = e.currentTarget;
                            const naturalW = img.naturalWidth;
                            const naturalH = img.naturalHeight;
                            const imageAspect = naturalW / naturalH;
                            const canvasAspect = rect.width / rect.height;
                            let renderW = rect.width;
                            let renderH = rect.height;
                            let offsetX = 0;
                            let offsetY = 0;
                            if (imageAspect > canvasAspect) {
                              renderH = rect.width / imageAspect;
                              offsetY = (rect.height - renderH) / 2;
                            } else {
                              renderW = rect.height * imageAspect;
                              offsetX = (rect.width - renderW) / 2;
                            }
                            let clickX = e.clientX - rect.left - offsetX;
                            let clickY = e.clientY - rect.top - offsetY;
                            if (clickX < 0 || clickX > renderW || clickY < 0 || clickY > renderH) return;
                            const x = (clickX / renderW) * naturalW;
                            const y = (clickY / renderH) * naturalH;
                            wsRef.current.send(JSON.stringify({ type: 'mousedown', x, y, button: e.button === 0 ? 'left' : e.button === 2 ? 'right' : 'middle' }));
                         }}
                         onMouseUp={(e) => {
                            if (isAiLoading || !wsRef.current) return;
                            const rect = e.currentTarget.getBoundingClientRect();
                            const img = e.currentTarget;
                            const naturalW = img.naturalWidth;
                            const naturalH = img.naturalHeight;
                            const imageAspect = naturalW / naturalH;
                            const canvasAspect = rect.width / rect.height;
                            let renderW = rect.width;
                            let renderH = rect.height;
                            let offsetX = 0;
                            let offsetY = 0;
                            if (imageAspect > canvasAspect) {
                              renderH = rect.width / imageAspect;
                              offsetY = (rect.height - renderH) / 2;
                            } else {
                              renderW = rect.height * imageAspect;
                              offsetX = (rect.width - renderW) / 2;
                            }
                            let clickX = e.clientX - rect.left - offsetX;
                            let clickY = e.clientY - rect.top - offsetY;
                            if (clickX < 0 || clickX > renderW || clickY < 0 || clickY > renderH) return;
                            const x = (clickX / renderW) * naturalW;
                            const y = (clickY / renderH) * naturalH;
                            wsRef.current.send(JSON.stringify({ type: 'mouseup', x, y, button: e.button === 0 ? 'left' : e.button === 2 ? 'right' : 'middle' }));
                         }}
                         onClick={(e) => {
                            if (isAiLoading || !wsRef.current) return;
                            const rect = e.currentTarget.getBoundingClientRect();
                            const img = e.currentTarget;
                            const naturalW = img.naturalWidth;
                            const naturalH = img.naturalHeight;
                            const imageAspect = naturalW / naturalH;
                            const canvasAspect = rect.width / rect.height;
                            let renderW = rect.width;
                            let renderH = rect.height;
                            let offsetX = 0;
                            let offsetY = 0;
                            if (imageAspect > canvasAspect) {
                              renderH = rect.width / imageAspect;
                              offsetY = (rect.height - renderH) / 2;
                            } else {
                              renderW = rect.height * imageAspect;
                              offsetX = (rect.width - renderW) / 2;
                            }
                            let clickX = e.clientX - rect.left - offsetX;
                            let clickY = e.clientY - rect.top - offsetY;
                            if (clickX < 0 || clickX > renderW || clickY < 0 || clickY > renderH) return;
                            const x = (clickX / renderW) * naturalW;
                            const y = (clickY / renderH) * naturalH;

                            // Send click event
                            wsRef.current.send(JSON.stringify({ type: "click", x, y }));
                            
                            // Check if an input was clicked for mobile keyboard support
                            const pad = 15;
                            const clickedInput = inputRects.find(r => 
                                x >= (r.x - pad) && x <= (r.x + r.w + pad) && 
                                y >= (r.y - pad) && y <= (r.y + r.h + pad)
                            );
                            
                            if (clickedInput && hiddenInputRef.current) {
                                const left = (clickedInput.x / remoteSize.w) * 100;
                                const top = (clickedInput.y / remoteSize.h) * 100;
                                const width = (clickedInput.w / remoteSize.w) * 100;
                                const height = (clickedInput.h / remoteSize.h) * 100;

                                hiddenInputRef.current.style.left = `${left}%`;
                                hiddenInputRef.current.style.top = `${top}%`;
                                hiddenInputRef.current.style.width = `${width}%`;
                                hiddenInputRef.current.style.height = `${height}%`;
                                hiddenInputRef.current.style.display = "block";
                                
                                setKeyboardInput(clickedInput.val || "");
                                hiddenInputRef.current.focus({ preventScroll: true });
                            } else if (hiddenInputRef.current) {
                                hiddenInputRef.current.style.display = "none";
                                hiddenInputRef.current.blur();
                            }
                         }}
                         onMouseMove={(e) => {
                            if (isAiLoading || !wsRef.current || e.buttons === 0) return; // only track drag
                            const rect = e.currentTarget.getBoundingClientRect();
                            const img = e.currentTarget;
                            const naturalW = img.naturalWidth;
                            const naturalH = img.naturalHeight;
                            const imageAspect = naturalW / naturalH;
                            const canvasAspect = rect.width / rect.height;
                            let renderW = rect.width;
                            let renderH = rect.height;
                            let offsetX = 0;
                            let offsetY = 0;
                            if (imageAspect > canvasAspect) {
                              renderH = rect.width / imageAspect;
                              offsetY = (rect.height - renderH) / 2;
                            } else {
                              renderW = rect.height * imageAspect;
                              offsetX = (rect.width - renderW) / 2;
                            }
                            let clickX = e.clientX - rect.left - offsetX;
                            let clickY = e.clientY - rect.top - offsetY;
                            if (clickX < 0 || clickX > renderW || clickY < 0 || clickY > renderH) return;
                            const x = (clickX / renderW) * naturalW;
                            const y = (clickY / renderH) * naturalH;
                            wsRef.current.send(JSON.stringify({ type: "mousemove", x, y }));
                         }}
                         onWheel={(e) => {
                            if (isAiLoading || !wsRef.current) return;
                            wsRef.current.send(JSON.stringify({ type: 'wheel', deltaX: e.deltaX, deltaY: e.deltaY }));
                         }}
                       />
                       
                       {/* SINGLE MOBILE INPUT FOR NATIVE KEYBOARD */}
                       <input 
                           ref={hiddenInputRef}
                           className="absolute z-10"
                           style={{
                               display: 'none',
                               background: 'transparent',
                               color: 'transparent',
                               border: 'none',
                               outline: 'none',
                               caretColor: 'transparent',
                               fontSize: '16px', // Prevent iOS zoom
                               touchAction: 'manipulation'
                           }}
                           value={keyboardInput}
                           onChange={(e) => {
                               const newValue = e.target.value;
                               const oldValue = keyboardInput;
                               if (wsRef.current) {
                                   if (newValue.length < oldValue.length) {
                                       const diff = oldValue.length - newValue.length;
                                       for (let d = 0; d < diff; d++) {
                                           wsRef.current.send(JSON.stringify({ type: 'keydown', key: 'Backspace' }));
                                       }
                                   } else if (newValue.length > oldValue.length) {
                                       const added = newValue.substring(oldValue.length);
                                       wsRef.current.send(JSON.stringify({ type: 'insertText', text: added }));
                                   }
                               }
                               setKeyboardInput(newValue);
                           }}
                           onKeyDown={(e) => {
                               if (e.key === 'Enter') {
                                   wsRef.current?.send(JSON.stringify({ type: 'keydown', key: 'Enter' }));
                                   e.currentTarget.blur();
                                   e.currentTarget.style.display = 'none';
                               }
                           }}
                           autoComplete="off"
                           autoCorrect="off"
                           spellCheck="false"
                       />

                       </div>
                    ) : (
                       <div className="absolute inset-0 flex flex-col gap-3 items-center justify-center text-[#8E8E93]">
                         <div className="w-8 h-8 border-4 border-[#3A3A3C] border-t-[#0A84FF] rounded-full animate-spin"></div>
                         <div className="text-sm font-medium animate-pulse">Tarayıcı Motoru Başlatılıyor...</div>
                       </div>
                    )}
                 </div>
              </div>
          </div>

          {/* CHAT CONTAINER */}
          <div className={`absolute inset-0 flex flex-col transition-opacity duration-300 ease-in bg-[#0A0A0A] ${view === 'chat' ? 'opacity-100 z-10' : 'opacity-0 pointer-events-none z-0'}`}>
              <div className="flex-1 overflow-y-auto p-4 lg:p-8 flex flex-col gap-6 w-full max-w-4xl mx-auto h-[calc(100vh-140px)]">
                {chatMessages.length === 0 ? (
                   <div className="flex-1 flex flex-col items-center justify-center text-center opacity-70 mt-10">
                      <Sparkles className="w-12 h-12 mb-5 text-indigo-400" />
                      <h2 className="text-2xl font-bold mb-3 text-white">Otobot AI'a Hoş Geldiniz</h2>
                      <p className="text-sm max-w-[280px] sm:max-w-sm text-slate-400 leading-relaxed font-medium">Headless Browser entegrasyonu başlatıldı. İnternette yapmak istediğinizi yazın.</p>
                   </div>
                ) : (
                   chatMessages.map(msg => (
                      <div key={msg.id} className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                         <div className={`max-w-[88%] lg:max-w-[70%] rounded-2xl px-5 py-3.5 text-[15px] leading-relaxed shadow-sm ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-br-sm' : 'bg-[#1A1A1A] text-slate-200 border border-white/5 rounded-bl-sm whitespace-pre-wrap font-mono'}`}>
                            {msg.role === 'assistant' && (
                              <div className="flex items-center gap-2 mb-2 pb-2 border-b border-white/5 text-[11px] font-bold text-indigo-400 font-sans uppercase tracking-wider">
                                <Bot className="w-3.5 h-3.5" /> Otobot
                              </div>
                            )}
                            {msg.content}
                         </div>
                      </div>
                   ))
                )}
                {isAiLoading && (
                   <div className="flex justify-start w-full">
                     <div className="max-w-[85%] rounded-2xl px-5 py-4 text-sm bg-[#1A1A1A] border border-white/5 text-slate-400 animate-pulse flex items-center gap-3 rounded-bl-sm">
                        <div className="flex gap-1.5 pt-0.5">
                          <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                          <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                          <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                        </div>
                        <span className="ml-1 font-medium text-xs tracking-wide">Otobot düşünüyor...</span>
                     </div>
                   </div>
                )}
                <div ref={messagesEndRef} className="h-4 shrink-0" />
              </div>
              
              <div className="p-4 lg:p-6 w-full max-w-4xl mx-auto flex-shrink-0 bg-gradient-to-t from-[#0A0A0A] via-[#0A0A0A] to-transparent z-20 absolute bottom-0 left-0 right-0">
                <div className="bg-[#1A1A1A] border border-white/10 rounded-2xl p-2 flex items-end relative focus-within:border-white/30 transition-colors shadow-2xl">
                   <textarea
                     value={aiPrompt}
                     onChange={e => setAiPrompt(e.target.value)}
                     onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                           e.preventDefault();
                           handleAiSubmit();
                        }
                     }}
                     disabled={isAiLoading}
                     placeholder="Otobot AI'a komut ver..."
                     className="w-full bg-transparent min-h-[50px] max-h-40 outline-none resize-none p-3 text-base text-white placeholder-white/30 font-medium"
                   />
                   <button 
                     onClick={handleAiSubmit}
                     disabled={isAiLoading || !aiPrompt.trim()}
                     className="w-12 h-12 shrink-0 bg-white text-black hover:bg-slate-200 rounded-xl flex items-center justify-center transition-all active:scale-95 disabled:bg-white/10 disabled:text-white/30 mb-0.5 mr-0.5"
                   >
                     <Send className="w-5 h-5 ml-1" />
                   </button>
                </div>
                <div className="text-center mt-3 text-[10px] text-white/30 hidden sm:block">
                  Otobot AI Playwright tabanlı Headless Tarayıcı Otomasyon motorunu kullanır.
                </div>
              </div>
          </div>
      </main>

      {/* RENDER AI AUTOMATION POINTER */}
      {aiActiveTarget && (
        <div
          className="fixed z-[9999] pointer-events-none top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 animate-bounce flex flex-col items-center gap-1"
        >
          <MousePointer2 className="w-4 h-4 text-black fill-black drop-shadow-md" />
        </div>
      )}

      {/* LOGIN MODAL */}
      {showLoginModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4">
          <div className="bg-[#202124] rounded-xl shadow-2xl w-full max-w-sm p-6 border border-[#3A3A3C]">
            <h2 className="text-[#E8EAED] text-xl font-medium mb-1">Google ile Giriş Yap</h2>
            <p className="text-[#9AA0A6] text-sm mb-6">Otomatik tarayıcı modülüne giriş bilgilerini ver. (Bilgiler tarayıcı oturumuna yazılacaktır.)</p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-[#9AA0A6] text-xs font-medium mb-1">E-posta Adresi</label>
                <input 
                   type="email" 
                   value={loginEmail}
                   onChange={e => setLoginEmail(e.target.value)}
                   className="w-full bg-[#323639] border border-[#3A3A3C] text-[#E8EAED] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#8AB4F8]"
                   placeholder="ornek@gmail.com"
                />
              </div>
              <div>
                 <label className="block text-[#9AA0A6] text-xs font-medium mb-1">Şifre</label>
                 <input 
                    type="password" 
                    value={loginPassword}
                    onChange={e => setLoginPassword(e.target.value)}
                    className="w-full bg-[#323639] border border-[#3A3A3C] text-[#E8EAED] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#8AB4F8]"
                    placeholder="••••••••"
                 />
              </div>
            </div>
            
            <div className="mt-8 flex justify-end gap-3">
              <button 
                onClick={() => setShowLoginModal(false)}
                className="px-4 py-2 text-[#8AB4F8] hover:bg-[#8AB4F8]/10 rounded-lg text-sm font-medium transition-colors cursor-pointer"
              >
                İptal
              </button>
              <button 
                onClick={async () => {
                   setShowLoginModal(false);
                   if (!sessionId || isAiLoading) return;
                   // Use entered credentials instead of hardcoded
                   await handleAction(sessionId, 'GOOGLE_LOGIN', { 
                       email: loginEmail, 
                       password: loginPassword 
                   });
                   // Clear fields after usage
                   setLoginEmail("");
                   setLoginPassword("");
                }}
                disabled={!loginEmail || !loginPassword}
                className="px-4 py-2 bg-[#8AB4F8] text-[#202124] rounded-lg text-sm font-medium leading-none hover:bg-[#aecbfa] transition-colors disabled:opacity-50 cursor-pointer"
              >
                Giriş Yap
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
