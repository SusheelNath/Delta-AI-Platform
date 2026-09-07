import React, { useRef, useEffect, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import useStore from '../../store/useStore';
import { streamChat, transcribeAudio, speakText } from '../../api/client';
import {
  createVoiceManager,
  playAudio,
  stripSubmitPhrase,
} from '../../utils/voiceManager';
import { resolveAction } from '../../utils/actionResolver';
import './ChatPanel.css';

const WELCOME_MESSAGE = {
  role: 'delta',
  text: 'Hello! I\'m Delta AI. Ask me about any space, floor, facility in the hospital, or click a room in the 3D view and ask me about it.',
  time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
};

export default function ChatPanel() {
  const messages = useStore((s) => s.messages);
  const addMessage = useStore((s) => s.addMessage);
  const appendToLastMessage = useStore((s) => s.appendToLastMessage);
  const isGenerating = useStore((s) => s.isGenerating);
  const setGenerating = useStore((s) => s.setGenerating);
  const viewerReady = useStore((s) => s.viewerReady);
  const selectedSpaceId = useStore((s) => s.selectedSpaceId);
  const selectedSpace = useStore((s) => s.selectedSpace);

  // Voice state
  const voiceActive = useStore((s) => s.voiceActive);
  const voiceState = useStore((s) => s.voiceState);
  const setVoiceActive = useStore((s) => s.setVoiceActive);
  const setVoiceState = useStore((s) => s.setVoiceState);

  const [input, setInput] = useState('');
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);

  // Voice refs
  const voiceManagerRef = useRef(null);
  const voiceActiveRef = useRef(false);
  const prevGeneratingRef = useRef(false);

  // Keep ref in sync
  useEffect(() => {
    voiceActiveRef.current = voiceActive;
  }, [voiceActive]);

  // ── Welcome message ──
  const welcomeSent = useRef(false);
  useEffect(() => {
    if (!welcomeSent.current && messages.length === 0) {
      welcomeSent.current = true;
      addMessage(WELCOME_MESSAGE);
    }
  }, []);

  // ── Auto-scroll ──
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Expose input ref for MetadataCard "Ask Delta" prefill ──
  useEffect(() => {
    window.__deltaInputRef = inputRef;
    window.__deltaSetInput = setInput;
    return () => {
      delete window.__deltaInputRef;
      delete window.__deltaSetInput;
    };
  }, []);

  // ── Abort in-flight stream on unmount ──
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, []);

  // ── Single unified voice manager (created once on mount) ──
  useEffect(() => {
    const mgr = createVoiceManager({
      onWake: () => {
        if (!voiceActiveRef.current) activateVoice();
      },
      onStop: () => {
        if (voiceActiveRef.current) deactivateVoice();
      },
      onInterim: (text) => {
        setInput(text);
      },
      onSubmit: (audioBlob, webSpeechText) => {
        handleVoiceSubmit(audioBlob, webSpeechText);
      },
      onClear: () => {
        setInput('');
        // If generating, also cancel the in-flight request
        if (abortRef.current) {
          abortRef.current.abort();
          abortRef.current = null;
        }
        useStore.getState().setGenerating(false);
      },
      onError: (err) => {
        console.warn('[Voice] Error:', err);
      },
    });
    mgr.start();
    voiceManagerRef.current = mgr;

    return () => mgr.destroy();
  }, []);

  // ── Post-generation: return to listening ──
  useEffect(() => {
    if (prevGeneratingRef.current && !isGenerating && voiceActiveRef.current) {
      if (voiceActiveRef.current) {
        setInput('');
        setVoiceState('listening');
        voiceManagerRef.current?.setMode('listening');
      }
    }
    prevGeneratingRef.current = isGenerating;
  }, [isGenerating]);

  // ── Voice activation / deactivation ──

  const activateVoice = useCallback(async () => {
    setVoiceActive(true);
    setVoiceState('greeting');

    try {
      voiceManagerRef.current?.mute();
      const audio = await speakText('', 'greeting');
      await playAudio(audio);
      // Grace period — mic still picks up speaker residue after audio ends
      await new Promise((r) => setTimeout(r, 700));
    } catch (err) {
      console.warn('[Voice] Greeting TTS failed:', err);
    } finally {
      voiceManagerRef.current?.unmute();
    }

    // After greeting, switch to listening mode and clear any leaked text
    if (voiceActiveRef.current) {
      setInput('');
      setVoiceState('listening');
      voiceManagerRef.current?.setMode('listening');
    }
  }, [setVoiceActive, setVoiceState]);

  const deactivateVoice = useCallback(async () => {
    voiceManagerRef.current?.setMode('idle');
    voiceManagerRef.current?.mute();
    try {
      const audio = await speakText('', 'goodbye');
      await playAudio(audio);
    } catch (_) {
      /* non-critical */
    } finally {
      voiceManagerRef.current?.unmute();
    }
    setVoiceActive(false);
    setVoiceState('idle');
    setInput('');
  }, [setVoiceActive, setVoiceState]);

  // ── Voice submit (triggered by "Send") ──

  const handleVoiceSubmit = useCallback(async (audioBlob, webSpeechText) => {
    if (!voiceActiveRef.current) return;

    setInput(webSpeechText);
    setVoiceState('processing');

    let finalText = webSpeechText;

    // Verify with Whisper (Groq → local fallback)
    if (audioBlob && audioBlob.size > 0) {
      try {
        const { text: whisperText } = await transcribeAudio(audioBlob);
        if (whisperText && whisperText.trim()) {
          finalText = stripSubmitPhrase(whisperText);
          setInput(finalText);
        }
      } catch (err) {
        console.warn('[Voice] Whisper verification failed, using Web Speech text:', err);
      }
    }

    if (finalText) {
      handleSend(finalText);
    } else {
      // Empty — go back to listening
      if (voiceActiveRef.current) {
        setVoiceState('listening');
        voiceManagerRef.current?.setMode('listening');
      }
    }
  }, [setVoiceState]);

  // ── Stop generation ──

  const handleStop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setGenerating(false);
  }, [setGenerating]);

  // ── Send message ──

  const handleSend = useCallback(async (overrideText) => {
    const text = (overrideText || input).trim();
    if (!text || isGenerating) return;

    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const userMsg = { role: 'user', text, time: now };
    addMessage(userMsg);
    setInput('');

    // Play "One moment, please." if voice is active (blocks until done)
    const voiceOn = voiceActiveRef.current;
    if (voiceOn) {
      voiceManagerRef.current?.mute();
      try {
        setVoiceState('acknowledging');
        const ackAudio = await speakText('', 'acknowledging');
        await playAudio(ackAudio);
        await new Promise((r) => setTimeout(r, 400));
      } catch (_) {
        /* non-critical */
      } finally {
        voiceManagerRef.current?.unmute();
      }
      setVoiceState('processing');
    }

    // Create placeholder for streaming
    const deltaMsg = { role: 'delta', text: '', time: '' };
    addMessage(deltaMsg);
    setGenerating(true);

    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      const currentMessages = useStore.getState().messages;
      const conversation = currentMessages.filter(
        (m, i) => i < currentMessages.length - 1,
      );

      const reader = await streamChat(conversation, selectedSpaceId, abortController.signal);
      const decoder = new TextDecoder();
      let firstToken = true;

      // Play "Here is what I found." concurrently — voice speaks while text streams
      if (voiceOn) {
        (async () => {
          try {
            voiceManagerRef.current?.mute();
            setVoiceState('announcing');
            const annPhrase = selectedSpaceId ? 'announcing_space' : 'announcing';
            const annAudio = await speakText('', annPhrase);
            await playAudio(annAudio);
            await new Promise((r) => setTimeout(r, 700));
          } catch (_) {
            /* non-critical */
          } finally {
            voiceManagerRef.current?.unmute();
          }
        })();
      }

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          if (data.startsWith('[ERROR]')) {
            appendToLastMessage(`\n\n_Error: ${data.slice(8)}_`);
            continue;
          }

          // Handle tool-call actions from LLM
          if (data.startsWith('[ACTION]')) {
            try {
              const actionPayload = JSON.parse(data.slice(8));
              resolveAction(actionPayload);
            } catch (e) {
              console.warn('[Chat] Failed to parse action:', e);
            }
            continue;
          }

          if (firstToken) {
            firstToken = false;
            const msgs = useStore.getState().messages;
            const last = msgs[msgs.length - 1];
            if (last && last.role === 'delta' && last.text === '') {
              const updated = [...msgs];
              updated[updated.length - 1] = {
                ...last,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              };
              useStore.setState({ messages: updated });
            }
          }
          // Restore newlines that were escaped for SSE transport
          appendToLastMessage(data.replace(/\\n/g, '\n'));
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        appendToLastMessage('\n\n_(stopped)_');
      } else {
        console.error('Chat error:', err);
        const msgs = useStore.getState().messages;
        const last = msgs[msgs.length - 1];
        if (last && last.role === 'delta' && last.text === '') {
          const updated = [...msgs];
          updated[updated.length - 1] = {
            ...last,
            text: `Could not reach Delta AI. Make sure the backend and Ollama are running.\n\n_${err.message}_`,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          };
          useStore.setState({ messages: updated });
        } else {
          appendToLastMessage(`\n\n_Error: ${err.message}_`);
        }
      }
    } finally {
      setGenerating(false);
      abortRef.current = null;
    }
  }, [input, isGenerating, addMessage, appendToLastMessage, setGenerating, selectedSpaceId, setVoiceState]);

  // ── Mic button click ──

  const handleMicToggle = useCallback(() => {
    if (voiceActive) {
      deactivateVoice();
    } else {
      activateVoice();
    }
  }, [voiceActive, activateVoice, deactivateVoice]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Derive mic button CSS modifier
  const micModifier = voiceActive
    ? `chat-panel__mic-btn--${voiceState}`
    : '';

  return (
    <div className="chat-panel">
      {/* Header */}
      <div className="chat-panel__header">
        <div className="chat-panel__header-left">
          <span className="chat-panel__title">Delta</span>
          <span className={`chat-panel__status-dot ${viewerReady ? 'chat-panel__status-dot--ready' : ''}`} />
        </div>
        <span className="chat-panel__header-sub">AI Assistant</span>
      </div>

      {/* Context indicator */}
      {selectedSpace && (
        <div className="chat-panel__context">
          <span className="chat-panel__context-label">Context:</span>
          <span className="chat-panel__context-value">
            {selectedSpace.space_name || selectedSpace.id}
          </span>
        </div>
      )}

      {/* Voice status bar */}
      {voiceActive && (
        <div className="chat-panel__voice-bar">
          <span className="chat-panel__voice-dot" />
          <span className="chat-panel__voice-label">
            {voiceState === 'greeting' && 'Delta is greeting...'}
            {voiceState === 'listening' && 'Listening... say "Send" to send'}
            {voiceState === 'processing' && 'Verifying transcription...'}
            {voiceState === 'acknowledging' && 'One moment, please...'}
            {voiceState === 'announcing' && 'Here is what I found...'}
          </span>
          <button className="chat-panel__voice-stop" onClick={deactivateVoice}>
            End
          </button>
        </div>
      )}

      {/* Messages */}
      <div className="chat-panel__messages">
        {messages.map((msg, i) => {
          const prev = messages[i - 1];
          const showDivider = i > 0 && msg.role === 'user' && prev?.role === 'delta';
          return (
            <React.Fragment key={i}>
              {showDivider && (
                <div className="chat-panel__divider">
                  <span className="chat-panel__divider-text">{msg.time}</span>
                </div>
              )}
              <div className={`chat-panel__message chat-panel__message--${msg.role}`}>
                <div className="chat-panel__bubble">
                  {msg.role === 'delta' ? (
                    <div className="chat-panel__bubble-text chat-panel__markdown">
                      <ReactMarkdown
                        components={{
                          table: ({ children }) => (
                            <div className="table-scroll"><table>{children}</table></div>
                          ),
                        }}
                      >{msg.text}</ReactMarkdown>
                    </div>
                  ) : (
                    <p className="chat-panel__bubble-text">{msg.text}</p>
                  )}
                  {msg.time && (
                    <span className="chat-panel__bubble-time">{msg.time}</span>
                  )}
                </div>
              </div>
            </React.Fragment>
          );
        })}

        {/* Typing indicator while generating */}
        {isGenerating && messages.length > 0 && messages[messages.length - 1]?.text === '' && (
          <div className="chat-panel__typing">
            <span /><span /><span />
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input tray */}
      <div className="chat-panel__input-tray">
        <div className="chat-panel__input-row">
          <input
            ref={inputRef}
            type="text"
            className="chat-panel__input"
            placeholder={
              voiceActive && voiceState === 'listening'
                ? 'Listening... speak now, say "Send" to send'
                : selectedSpace
                  ? `Ask about ${selectedSpace.space_name || 'this space'}...`
                  : 'Ask Delta about any space...'
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isGenerating}
          />
          <button
            className={`chat-panel__mic-btn ${micModifier}`}
            title={voiceActive ? 'Deactivate voice (or say "Stop Delta")' : 'Activate voice (or say "Hi Delta")'}
            onClick={handleMicToggle}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              {voiceActive ? (
                <>
                  <path d="M8 1a2.5 2.5 0 0 0-2.5 2.5v4a2.5 2.5 0 0 0 5 0v-4A2.5 2.5 0 0 0 8 1z" fill="currentColor"/>
                  <path d="M3.5 7v.5a4.5 4.5 0 0 0 9 0V7M8 12v2.5M5.5 14.5h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                </>
              ) : (
                <>
                  <path d="M8 1a2.5 2.5 0 0 0-2.5 2.5v4a2.5 2.5 0 0 0 5 0v-4A2.5 2.5 0 0 0 8 1z" stroke="currentColor" strokeWidth="1.2"/>
                  <path d="M3.5 7v.5a4.5 4.5 0 0 0 9 0V7M8 12v2.5M5.5 14.5h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                </>
              )}
            </svg>
          </button>
          {isGenerating ? (
            <button className="chat-panel__stop-btn" onClick={handleStop} title="Stop generating">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect x="2" y="2" width="10" height="10" rx="2" fill="currentColor"/>
              </svg>
            </button>
          ) : (
            <button className="chat-panel__send-btn" onClick={() => handleSend()} title="Send message">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M14 2L7 9M14 2l-4.5 12L7 9 2 7.5 14 2z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
