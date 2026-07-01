import { useState, useRef, useEffect } from "react";
import { Sparkles, X, Send, Loader, MessageSquare } from "lucide-react";
import { apiClient } from "../../lib/apiClient";
import { useTenant } from "../../store/tenantContext";

interface Message { role: 'user' | 'ai'; content: string; ts: Date; }

const QUICK_PROMPTS = [
  "Shipment mana yang paling berisiko hari ini?",
  "Berapa total nilai CIF bulan ini?",
  "Dokumen apa yang paling sering perlu review?",
];

export function AiChatWidget() {
  const { currentTenant } = useTenant();
  const [open, setOpen]         = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput]       = useState('');
  const [loading, setLoading]   = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || !currentTenant) return;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: msg, ts: new Date() }]);
    setLoading(true);
    try {
      const { data } = await apiClient.post(`/tenants/${currentTenant.id}/ai-chat`, { message: msg });
      setMessages(prev => [...prev, { role: 'ai', content: data.answer, ts: new Date() }]);
    } catch {
      setMessages(prev => [...prev, { role: 'ai', content: 'Maaf, tidak dapat memproses pertanyaan ini saat ini.', ts: new Date() }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Floating button */}
      <button onClick={() => setOpen(o => !o)}
        className="fixed bottom-6 right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-[#0EA5A4] shadow-lg hover:bg-teal-600 transition-colors">
        {open ? <X size={20} className="text-white" /> : <Sparkles size={20} className="text-white" />}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-20 right-6 z-50 w-80 rounded-lg border border-[#DFE1E6] bg-white shadow-xl flex flex-col"
          style={{ height: '420px' }}>
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-[#DFE1E6] px-4 py-3 bg-[#1B2A4A] rounded-t-lg">
            <Sparkles size={14} className="text-[#0EA5A4]" />
            <span className="text-sm font-semibold text-white">NexTrade AI</span>
            <span className="ml-auto text-[10px] text-white/50">Tanya data sistem</span>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.length === 0 && (
              <div className="text-center py-4">
                <Sparkles size={24} className="text-[#DFE1E6] mx-auto mb-2" />
                <p className="text-xs text-[#6B778C] mb-3">Tanya tentang shipment, dokumen, atau kepatuhan</p>
                <div className="space-y-1.5">
                  {QUICK_PROMPTS.map((p, i) => (
                    <button key={i} onClick={() => send(p)}
                      className="w-full text-left rounded border border-[#DFE1E6] px-2.5 py-1.5 text-[11px] text-[#6B778C] hover:bg-[#F4F5F7] hover:text-[#1B2A4A] transition-colors">
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-[#1B2A4A] text-white'
                    : 'bg-[#F4F5F7] text-[#1B2A4A] border border-[#DFE1E6]'
                }`}>
                  {m.role === 'ai' && (
                    <div className="flex items-center gap-1 mb-1">
                      <Sparkles size={10} className="text-[#0EA5A4]" />
                      <span className="text-[10px] font-semibold text-[#0EA5A4]">AI</span>
                    </div>
                  )}
                  <p className="whitespace-pre-wrap">{m.content}</p>
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-[#F4F5F7] border border-[#DFE1E6] rounded-lg px-3 py-2">
                  <Loader size={12} className="text-[#0EA5A4] animate-spin" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="border-t border-[#DFE1E6] p-2 flex gap-2">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
              placeholder="Tanya tentang data..."
              className="flex-1 rounded border border-[#DFE1E6] bg-[#F4F5F7] px-2.5 py-1.5 text-xs outline-none focus:border-[#0EA5A4]"
            />
            <button onClick={() => send()} disabled={!input.trim() || loading}
              className="flex items-center justify-center rounded bg-[#0EA5A4] p-1.5 text-white hover:bg-teal-600 disabled:opacity-40 transition-colors">
              <Send size={13} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
