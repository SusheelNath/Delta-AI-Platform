import React, { useRef, useEffect, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import useStore from '../../store/useStore';
import { streamChat, fetchIntents, transcribeAudio, speakText, fetchSpaceFurnishings } from '../../api/client';
import {
  createVoiceManager,
  playAudio,
  stripSubmitPhrase,
} from '../../utils/voiceManager';
import { resolveAction } from '../../utils/actionResolver';
import { getActionTemplate, wrapConfirmation } from '../../utils/actionTemplates';
import './ChatPanel.css';

const ACTION_LABELS = {
  set_floor: 'Navigating',
  set_heatmap: 'Setting heatmap',
  reset_heatmap: 'Clearing heatmap',
  reset_filters: 'Resetting filters',
  select_space: 'Selecting space',
  toggle_function_filter: 'Filtering',
  clear_selection: 'Clearing selection',
  expand_directory_group: 'Opening directory',
  select_room_in_group: 'Selecting room',
  toggle_drawer: 'Opening panel',
  route_to_elevator: 'Finding elevator',
  route_to_staircase: 'Finding stairs',
  clear_route: 'Clearing route',
  highlight_spaces: 'Highlighting spaces',
  highlight_adjacent: 'Finding adjacent',
  clear_all: 'Clearing all',
  set_search: 'Searching',
  zoom_view: 'Adjusting view',
  fly_to_zone: 'Flying to zone',
  modify_furnishing: 'Updating furnishings',
  suggest_furnishings: 'Opening editor',
};

function formatActionLabel(type) {
  return ACTION_LABELS[type] || type.replace(/_/g, ' ');
}

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
  const activeFloorId = useStore((s) => s.activeFloorId);
  const currentExpandedGroup = useStore((s) => s.currentExpandedGroup);

  // Voice state
  const voiceActive = useStore((s) => s.voiceActive);
  const voiceState = useStore((s) => s.voiceState);
  const setVoiceActive = useStore((s) => s.setVoiceActive);
  const setVoiceState = useStore((s) => s.setVoiceState);

  const [input, setInputRaw] = useState('');
  const [pendingPhase, setPendingPhase] = useState('idle'); // 'idle' | 'detecting' | 'generating'
  const [completedActions, setCompletedActions] = useState([]);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const msgScrollState = useRef({ target: 0, current: 0, raf: null });
  const inputRef = useRef(null);
  const abortRef = useRef(null);

  // Voice refs
  const voiceManagerRef = useRef(null);
  const voiceActiveRef = useRef(false);
  const prevGeneratingRef = useRef(false);

  // Track current input value in a ref so voice submit can read it synchronously
  const inputValueRef = useRef('');
  const setInput = useCallback((val) => {
    setInputRaw(val);
    inputValueRef.current = val;
  }, []);

  // Keep ref in sync
  useEffect(() => {
    voiceActiveRef.current = voiceActive;
  }, [voiceActive]);

  // ── Load session list + learnings on mount ──
  const loadSessionList = useStore((s) => s.loadSessionList);
  const fetchLearnings = useStore((s) => s.fetchLearnings);
  useEffect(() => {
    loadSessionList();
    fetchLearnings();
  }, []);

  // ── Welcome message (re-fires when messages cleared by New Chat) ──
  const isEmpty = messages.length === 0;
  useEffect(() => {
    if (isEmpty && useStore.getState().messages.length === 0) {
      addMessage(WELCOME_MESSAGE);
    }
  }, [isEmpty]);

  // ── Auto-scroll ──
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Lerped smooth scroll for messages ──
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const s = msgScrollState.current;
    s.current = el.scrollTop;
    s.target = el.scrollTop;

    const tick = () => {
      const diff = s.target - s.current;
      if (Math.abs(diff) < 0.3) {
        s.current = s.target;
        el.scrollTop = s.target;
        s.raf = null;
        return;
      }
      s.current += diff * 0.18;
      el.scrollTop = Math.round(s.current);
      s.raf = requestAnimationFrame(tick);
    };

    const onWheel = (e) => {
      e.preventDefault();
      const max = el.scrollHeight - el.clientHeight;
      s.target = Math.max(0, Math.min(max, s.target + e.deltaY * 0.8));
      if (!s.raf) s.raf = requestAnimationFrame(tick);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (s.raf) cancelAnimationFrame(s.raf);
    };
  }, []);

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

  // ── Voice submit (triggered by "Submit" or "Send Delta") ──

  const handleVoiceSubmit = useCallback(async (_audioBlob, webSpeechText) => {
    if (!voiceActiveRef.current) return;

    setVoiceState('processing');

    // Use the text currently displayed in the input field (what the user sees)
    // as the authoritative source — it's kept in sync by onInterim callbacks.
    // Fall back to the voice manager's internal text only if the field is empty.
    const displayedText = inputValueRef.current.trim();
    const finalText = stripSubmitPhrase(displayedText || webSpeechText);

    if (finalText) {
      setInput(finalText);
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

    // Bare "clear" — just clear the input, don't send anything
    if (/^clear\.?$/i.test(text)) {
      setInput('');
      return;
    }

    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const userMsg = { role: 'user', text, time: now };
    addMessage(userMsg);
    setInput('');
    setCompletedActions([]);
    setPendingPhase('detecting');

    const voiceOn = voiceActiveRef.current;

    // ── Resolve live context from store ──
    const liveState = useStore.getState();
    let effectiveFloor = liveState.activeFloorId;
    if (!effectiveFloor) {
      const visFloors = (liveState.floors || []).filter((f) => liveState.floorVisibility[f.id]);
      if (visFloors.length === 1) effectiveFloor = visFloors[0].id;
    }
    const effectiveSpace = liveState.selectedSpaceId;
    const effectiveSpaceData = liveState.selectedSpace;
    const effectiveGroup = liveState.currentExpandedGroup;

    // ── Phase 1: Instant intent detection — fire BEFORE voice ──
    // Fetch intents first so we can classify instant vs data actions.
    const INSTANT_ACTIONS = new Set([
      'toggle_drawer', 'clear_selection', 'clear_route', 'clear_all',
      'clear_highlights', 'clear_search', 'zoom_view', 'set_heatmap',
      'reset_heatmap', 'reset_filters', 'toggle_mep', 'set_panel_mode',
      'close_card', 'toggle_profile', 'set_floor_visibility',
      'enter_compare_mode', 'exit_compare_mode', 'voice_on', 'voice_off',
      'set_floor', 'set_floor_relative', 'show_all_floors',
      'toggle_function_filter', 'no_selection_hint', 'new_session',
      'open_toolkit_section', 'toggle_drawer',
      'expand_directory_group', 'highlight_spaces', 'highlight_adjacent',
      'count_highlight', 'set_search', 'fly_to_zone', 'clear_learnings',
      'load_session',
      'select_space', 'select_room_in_group',
      'route_to_elevator', 'route_to_staircase', 'compare_floors',
      'search_largest_rooms', 'find_room',
      'modify_furnishing', 'suggest_furnishings',
    ]);

    let actionsHandled = false;
    let phase1Content = null;
    let phase1Actions = [];
    try {
      const { actions, confirmations, content } = await fetchIntents(text, effectiveSpace, effectiveFloor, effectiveGroup, effectiveSpaceData);
      phase1Actions = actions;
      if (actions.length > 0) {
        const isInstant = actions.every((a) => INSTANT_ACTIONS.has(a.type));

        if (isInstant) {
          // ── Fast path: execute immediately, no voice overhead ──
          for (const action of actions) {
            await resolveAction(action);
          }
          const cleanLabels = confirmations
            .map((c) => c.replace(/\*\*/g, '').replace(/\.{3,}$/, '').trim());
          setCompletedActions(cleanLabels);

          // Build response text: rich template → wrapped confirmation → raw fallback
          const template = getActionTemplate(actions);
          const rawConfirm = content || cleanLabels.join(' ');
          const confirmText = template || wrapConfirmation(rawConfirm, actions);
          const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

          // Simulated streaming for all instant responses
          const deltaMsg = { role: 'delta', text: '', time: now, streaming: true };
          addMessage(deltaMsg);
          setPendingPhase('idle');
          setCompletedActions([]);

          const words = confirmText.split(/(\s+)/); // preserve whitespace
          let accumulated = '';
          for (let w = 0; w < words.length; w++) {
            accumulated += words[w];
            // Update every 3 tokens (~15ms per batch)
            if (w % 3 === 2 || w === words.length - 1) {
              const snapshot = accumulated;
              useStore.setState((state) => {
                const msgs = [...state.messages];
                const last = msgs[msgs.length - 1];
                if (last && last.role === 'delta' && last.streaming) {
                  msgs[msgs.length - 1] = { ...last, text: snapshot };
                }
                return { messages: msgs };
              });
              await new Promise((r) => setTimeout(r, 15));
            }
          }
          // Mark streaming complete
          useStore.setState((state) => {
            const msgs = [...state.messages];
            const last = msgs[msgs.length - 1];
            if (last && last.role === 'delta' && last.streaming) {
              msgs[msgs.length - 1] = { ...last, streaming: false };
            }
            return { messages: msgs };
          });
          useStore.getState().saveCurrentSession();

          // Restore voice listening mode (instant path never sets isGenerating,
          // so the post-generation useEffect won't fire)
          if (voiceOn) {
            setInput('');
            setVoiceState('listening');
            voiceManagerRef.current?.setMode('listening');
          }
          return;
        }

        // ── Data actions: execute actions now, voice comes after ──
        for (const action of actions) {
          await resolveAction(action);
        }
        const cleanLabels = confirmations
          .map((c) => c.replace(/\*\*/g, '').replace(/\.{3,}$/, '').trim());
        setCompletedActions(cleanLabels);
        actionsHandled = true;
      }
      if (content) {
        phase1Content = content;
      }
    } catch (e) {
      console.warn('[Chat] Intent detection failed, falling back to stream:', e);
    }

    // Create placeholder for streaming
    const deltaMsg = { role: 'delta', text: '', time: '' };
    addMessage(deltaMsg);
    setGenerating(true);

    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      const currentMessages = useStore.getState().messages;
      let conversation = currentMessages.filter(
        (m, i) => i < currentMessages.length - 1,
      );

      // Phase 1 fully resolved — display content and skip LLM
      if (phase1Content) {
        // Play "Here is what I found." for data results (skip for instant actions)
        if (voiceOn) {
          (async () => {
            const muteTimer = setTimeout(() => { voiceManagerRef.current?.unmute(); }, 8000);
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
              clearTimeout(muteTimer);
              voiceManagerRef.current?.unmute();
            }
          })();
        }
        const now2 = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        // Set timestamp and mark as streaming
        const msgs = useStore.getState().messages;
        const last = msgs[msgs.length - 1];
        if (last && last.role === 'delta' && last.text === '') {
          const updated = [...msgs];
          updated[updated.length - 1] = { ...last, time: now2, streaming: true };
          useStore.setState({ messages: updated });
        }
        setPendingPhase('idle');
        setCompletedActions([]);

        // Simulated streaming: reveal word-by-word
        const words = phase1Content.split(/(\s+)/);
        let accumulated = '';
        for (let w = 0; w < words.length; w++) {
          accumulated += words[w];
          if (w % 3 === 2 || w === words.length - 1) {
            const snapshot = accumulated;
            useStore.setState((state) => {
              const m = [...state.messages];
              const l = m[m.length - 1];
              if (l && l.role === 'delta' && l.streaming) {
                m[m.length - 1] = { ...l, text: snapshot };
              }
              return { messages: m };
            });
            await new Promise((r) => setTimeout(r, 15));
          }
        }
        // Mark streaming complete
        useStore.setState((state) => {
          const m = [...state.messages];
          const l = m[m.length - 1];
          if (l && l.role === 'delta' && l.streaming) {
            m[m.length - 1] = { ...l, streaming: false };
          }
          return { messages: m };
        });

        setGenerating(false);
        abortRef.current = null;
        // Save session + periodic learnings (same as Phase 2 finally block)
        useStore.getState().saveCurrentSession();
        const allMsgs = useStore.getState().messages;
        const userMsgCount = allMsgs.filter((m) => m.role === 'user').length;
        if (userMsgCount > 0 && userMsgCount % 3 === 0) {
          useStore.getState().generateLearnings();
        }
        return;
      }

      // Phase 2: Stream LLM narration (only for queries, evacuate, capacity_plan)
      // Play "One moment, please." only for LLM-bound requests (not instant actions)
      if (voiceOn) {
        voiceManagerRef.current?.mute();
        const ackTimer = setTimeout(() => { voiceManagerRef.current?.unmute(); }, 8000);
        try {
          setVoiceState('acknowledging');
          const ackAudio = await speakText('', 'acknowledging');
          await playAudio(ackAudio);
          await new Promise((r) => setTimeout(r, 400));
        } catch (_) {
          /* non-critical */
        } finally {
          clearTimeout(ackTimer);
          voiceManagerRef.current?.unmute();
        }
        setVoiceState('processing');
      }
      setPendingPhase('generating');

      // Re-read from store — intent actions may have navigated or selected a space
      const phase2State = useStore.getState();
      let effectiveFloorId = phase2State.activeFloorId;
      if (!effectiveFloorId) {
        const vis = (phase2State.floors || []).filter((f) => phase2State.floorVisibility[f.id]);
        if (vis.length === 1) effectiveFloorId = vis[0].id;
      }
      const effectiveSpaceId = phase2State.selectedSpaceId;
      const effectiveSpaceObj = phase2State.selectedSpace;

      const reader = await streamChat(
        conversation, effectiveSpaceId, effectiveFloorId,
        abortController.signal, actionsHandled, currentExpandedGroup, effectiveSpaceObj,
      );
      const decoder = new TextDecoder();
      let firstToken = true;
      let skipNextConfirm = false;

      // Play "Here is what I found." concurrently — voice speaks while text streams
      if (voiceOn) {
        (async () => {
          const annTimer = setTimeout(() => { voiceManagerRef.current?.unmute(); }, 8000);
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
            clearTimeout(annTimer);
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

          // Fallback: handle actions from stream (if intent detection failed)
          if (data.startsWith('[ACTION]')) {
            try {
              const actionPayload = JSON.parse(data.slice(8));
              await resolveAction(actionPayload);
              setCompletedActions((prev) => [...prev, formatActionLabel(actionPayload.type)]);
            } catch (e) {
              console.warn('[Chat] Failed to parse action:', e);
            }
            skipNextConfirm = true;
            continue;
          }

          // Skip confirmation text that follows [ACTION] — shown in indicator instead
          if (skipNextConfirm) {
            skipNextConfirm = false;
            continue;
          }

          // First LLM text token — dismiss indicator, set timestamp
          if (firstToken) {
            firstToken = false;
            setPendingPhase('idle');
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
      setPendingPhase('idle');
      setCompletedActions([]);
      abortRef.current = null;
      // Auto-save session after each exchange
      useStore.getState().saveCurrentSession();
      // Generate learnings every 3rd user message (fire-and-forget)
      const msgs = useStore.getState().messages;
      const userMsgCount = msgs.filter((m) => m.role === 'user').length;
      if (userMsgCount > 0 && userMsgCount % 3 === 0) {
        useStore.getState().generateLearnings();
      }
    }
  }, [input, isGenerating, addMessage, appendToLastMessage, setGenerating, selectedSpaceId, activeFloorId, currentExpandedGroup, setVoiceState]);

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

  const sessionHistoryOpen = useStore((s) => s.sessionHistoryOpen);
  const setSessionHistoryOpen = useStore((s) => s.setSessionHistoryOpen);
  const learningsPanelOpen = useStore((s) => s.learningsPanelOpen);
  const setLearningsPanelOpen = useStore((s) => s.setLearningsPanelOpen);
  const guideBookletOpen = useStore((s) => s.guideBookletOpen);
  const setGuideBookletOpen = useStore((s) => s.setGuideBookletOpen);

  return (
    <div className="chat-panel">
      {/* Header */}
      <div className="chat-panel__header">
        <div className="chat-panel__header-left">
          <span className="chat-panel__title">Delta</span>
          <span className={`chat-panel__status-dot ${viewerReady ? 'chat-panel__status-dot--ready' : ''}`} />
        </div>
        <div className="chat-panel__header-right">
          <button
            className={`chat-panel__brain-btn ${learningsPanelOpen ? 'chat-panel__brain-btn--active' : ''}`}
            onClick={() => setLearningsPanelOpen(!learningsPanelOpen)}
            title="AI learnings"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a7 7 0 0 1 7 7c0 2.5-1.3 4.7-3.2 6H8.2C6.3 13.7 5 11.5 5 9a7 7 0 0 1 7-7z" />
              <path d="M9 22h6M10 18h4M12 15v3" />
            </svg>
          </button>
          <button
            className={`chat-panel__guide-btn ${guideBookletOpen ? 'chat-panel__guide-btn--active' : ''}`}
            onClick={() => setGuideBookletOpen(!guideBookletOpen)}
            title="What can I do?"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              <line x1="8" y1="7" x2="16" y2="7" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </button>
          <button
            className={`chat-panel__history-btn ${sessionHistoryOpen ? 'chat-panel__history-btn--active' : ''}`}
            onClick={() => setSessionHistoryOpen(!sessionHistoryOpen)}
            title="Session history"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </button>
          <span className="chat-panel__header-sub">AI Assistant</span>
        </div>
      </div>

      {/* Session history panel */}
      {sessionHistoryOpen && <SessionHistory />}

      {/* Learnings panel */}
      {learningsPanelOpen && <LearningsPanel />}

      {/* Guide booklet */}
      {guideBookletOpen && (
        <div className="guide-booklet">
          <GuideBooklet onChipClick={(text) => {
            setGuideBookletOpen(false);

            // ── Special: "Edit furnishings" opens the editor + injects baseline snapshot ──
            if (text === 'Edit furnishings') {
              const state = useStore.getState();
              const space = state.selectedSpace;
              if (!space || !state.selectedSpaceId) {
                const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                addMessage({ role: 'delta', text: 'Please select a room first so I can open its furnishing editor.', time: now });
                return;
              }

              // Open the drawer + furnishing editor
              state.setDrawerOpen(true);
              window.dispatchEvent(new CustomEvent('delta-open-furnishing-editor'));

              // Build and inject baseline snapshot asynchronously
              (async () => {
                const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const spaceName = space.space_name || state.selectedSpaceId;
                const fn = space.primary_function || '';
                const area = space.area_m2 != null ? `${Number(space.area_m2).toFixed(1)} m²` : '--';

                let furnLines = [];
                try {
                  const furn = await fetchSpaceFurnishings(state.selectedSpaceId);
                  if (furn && furn.length > 0) {
                    for (const f of furn) {
                      const fp = f.footprint_m2 > 0 ? ` (${(f.footprint_m2 * f.quantity).toFixed(1)} m²)` : '';
                      furnLines.push(`- ${f.quantity}\u00D7 ${f.label || f.item_type}${fp}`);
                    }
                  }
                } catch (_) { /* furnishings fetch failed — continue without */ }

                const parts = [
                  `Opening the furnishing editor for **${spaceName}** (${fn}).`,
                  '',
                  '**Current baseline:**',
                  `Area: ${area} · Used: ${space.used_area_m2 != null ? Number(space.used_area_m2).toFixed(1) + ' m²' : '--'} · Free: ${space.free_area_m2 != null ? Number(space.free_area_m2).toFixed(1) + ' m²' : '--'}`,
                  `Occupancy: ${space.normal_occupancy ?? 0} normal / ${space.max_occupancy ?? 0} max / ${space.absolute_occupancy ?? 0} absolute`,
                ];

                if (furnLines.length > 0) {
                  parts.push('', '**Furnishings:**', ...furnLines);
                } else {
                  parts.push('', '_No furnishings currently placed._');
                }

                parts.push('', 'Make changes in the editor or ask me to add/remove items. I\'ll show you a before/after comparison when you save.');

                // Store baseline snapshot for before/after comparison (Task #9)
                useStore.setState({ _furnishingBaseline: {
                  spaceName,
                  spaceId: state.selectedSpaceId,
                  floorId: state.activeFloorId,
                  area_m2: space.area_m2,
                  used_area_m2: space.used_area_m2,
                  free_area_m2: space.free_area_m2,
                  normal_occupancy: space.normal_occupancy,
                  max_occupancy: space.max_occupancy,
                  absolute_occupancy: space.absolute_occupancy,
                  furnLines,
                }});

                addMessage({ role: 'delta', text: parts.join('\n'), time: now });
              })();
              return;
            }

            // Default: set input text for normal chips
            setInput(text);
            inputRef.current?.focus();
          }} />
        </div>
      )}

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
            {voiceState === 'listening' && 'Listening... say "Submit" or "Send Delta"'}
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
      <div className="chat-panel__messages" ref={messagesContainerRef}>
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

        {/* Multi-phase processing indicator */}
        {pendingPhase !== 'idle' && (
          <div className="chat-panel__pending">
            {completedActions.map((label, i) => (
              <span key={i} className="chat-panel__pending-done">
                <svg className="chat-panel__pending-check" width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2.5 6l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                {label}
              </span>
            ))}
            <span className="chat-panel__pending-phase">
              <span className="chat-panel__pending-dot" />
              {pendingPhase === 'detecting' ? 'Processing\u2026' : 'Generating response\u2026'}
            </span>
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
                ? 'Listening... say "Submit" or "Send Delta"'
                : selectedSpace
                  ? `Ask about ${selectedSpace.space_name || 'this space'}...`
                  : 'Ask Delta about any space...'
            }
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              voiceManagerRef.current?.syncText(e.target.value);
            }}
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

const GUIDE_TABS = [
  { label: 'Nav',       chips: ['Go to floor 1', 'Next floor', 'Previous floor', 'Show all floors'] },
  { label: 'Search',    chips: ['Largest rooms on this floor', 'Show elevators', 'Show staircases', 'Highlight all toilets', "What's adjacent to Nursing Station", 'How many clinical spaces'] },
  { label: 'Route',     chips: ['Nearest elevator', 'Nearest staircase', 'Clear route'] },
  { label: 'Plan',      chips: ['Best assembly points', 'Find a room for...', 'Edit furnishings'] },
  { label: 'Scenario',  chips: [] },
  { label: 'Clear',     chips: ['Clear', 'Normal view', 'Clear highlights'] },
];

function GuideBooklet({ onChipClick }) {
  const [activeIdx, setActiveIdx] = useState(null);
  const tabsRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = tabsRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 2);
  }, []);

  useEffect(() => {
    checkScroll();
    const el = tabsRef.current;
    if (!el) return;
    el.addEventListener('scroll', checkScroll, { passive: true });
    const ro = new ResizeObserver(checkScroll);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', checkScroll); ro.disconnect(); };
  }, [checkScroll]);

  const scroll = (dir) => {
    const el = tabsRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * 120, behavior: 'smooth' });
  };

  return (
    <div className="guide-booklet__strip">
      <div className="guide-booklet__tabs-wrapper">
        {canScrollLeft && (
          <button className="guide-booklet__arrow guide-booklet__arrow--left" onClick={() => scroll(-1)}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6.5 1.5 3.5 5 6.5 8.5" /></svg>
          </button>
        )}
        <div className="guide-booklet__tabs" ref={tabsRef}>
          {GUIDE_TABS.map((tab, i) => (
            <button
              key={tab.label}
              className={`guide-booklet__tab ${activeIdx === i ? 'guide-booklet__tab--active' : ''}`}
              onClick={() => setActiveIdx(activeIdx === i ? null : i)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {canScrollRight && (
          <button className="guide-booklet__arrow guide-booklet__arrow--right" onClick={() => scroll(1)}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3.5 1.5 6.5 5 3.5 8.5" /></svg>
          </button>
        )}
      </div>
      <div
        className="guide-booklet__reveal"
        style={{ maxHeight: activeIdx !== null ? '50px' : '0px' }}
      >
        {activeIdx !== null && (
          <div className="guide-booklet__chips" key={activeIdx}>
            {GUIDE_TABS[activeIdx].chips.map((chip) => (
              <button
                key={chip}
                className="guide-booklet__chip"
                onClick={() => onChipClick(chip)}
              >
                {chip}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const LEARNING_ICONS = {
  function_interest: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
  ),
  floor_preference: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
  ),
  facility_need: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
  ),
  general_observation: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 2a7 7 0 0 1 7 7c0 2.5-1.3 4.7-3.2 6H8.2C6.3 13.7 5 11.5 5 9a7 7 0 0 1 7-7z"/><path d="M10 18h4M12 15v3"/></svg>
  ),
};

function LearningsPanel() {
  const learnings = useStore((s) => s.learnings);
  const removeLearning = useStore((s) => s.removeLearning);
  const clearAllLearnings = useStore((s) => s.clearAllLearnings);
  const listRef = useRef(null);
  const scrollState = useRef({ target: 0, current: 0, raf: null });

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const s = scrollState.current;
    s.current = el.scrollTop;
    s.target = el.scrollTop;

    const tick = () => {
      const diff = s.target - s.current;
      if (Math.abs(diff) < 0.3) {
        s.current = s.target;
        el.scrollTop = s.target;
        s.raf = null;
        return;
      }
      s.current += diff * 0.18;
      el.scrollTop = Math.round(s.current);
      s.raf = requestAnimationFrame(tick);
    };

    const onWheel = (e) => {
      e.preventDefault();
      const max = el.scrollHeight - el.clientHeight;
      s.target = Math.max(0, Math.min(max, s.target + e.deltaY * 0.8));
      if (!s.raf) s.raf = requestAnimationFrame(tick);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (s.raf) cancelAnimationFrame(s.raf);
    };
  }, []);

  return (
    <div className="learnings-panel">
      <div className="learnings-panel__header">
        <span className="learnings-panel__title">Delta AI Learnings</span>
        {learnings.length > 0 && (
          <button className="learnings-panel__clear-btn" onClick={clearAllLearnings} title="Clear all learnings">
            Clear all
          </button>
        )}
      </div>
      <div className="learnings-panel__list" ref={listRef}>
        {learnings.length === 0 ? (
          <div className="learnings-panel__empty">
            No learnings yet. As you chat, Delta will learn your preferences.
          </div>
        ) : (
          learnings.map((lr) => (
            <div key={lr.id} className="learnings-panel__item">
              <div className="learnings-panel__item-icon">
                {LEARNING_ICONS[lr.learning_type] || LEARNING_ICONS.general_observation}
              </div>
              <div className="learnings-panel__item-body">
                <span className="learnings-panel__item-text">{lr.content}</span>
                <div className="learnings-panel__item-meta">
                  <div className="learnings-panel__confidence-bar">
                    <div
                      className="learnings-panel__confidence-fill"
                      style={{ width: `${Math.round(lr.confidence * 100)}%` }}
                    />
                  </div>
                  <span className="learnings-panel__item-count">
                    Seen {lr.observation_count}x
                  </span>
                </div>
              </div>
              <button
                className="learnings-panel__item-delete"
                onClick={() => removeLearning(lr.id)}
                title="Remove learning"
              >
                &times;
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function SessionHistory() {
  const sessionList = useStore((s) => s.sessionList);
  const activeSessionId = useStore((s) => s.activeSessionId);
  const loadSession = useStore((s) => s.loadSession);
  const newChat = useStore((s) => s.newChat);
  const removeSession = useStore((s) => s.removeSession);

  const formatDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const diff = now - d;
    if (diff < 86400000) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    if (diff < 604800000) {
      return d.toLocaleDateString([], { weekday: 'short' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  return (
    <div className="session-history">
      <div className="session-history__header">
        <span className="session-history__title">Sessions</span>
        <button className="session-history__new-btn" onClick={newChat} title="New chat">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Chat
        </button>
      </div>
      <div className="session-history__list">
        {sessionList.length === 0 ? (
          <div className="session-history__empty">No saved sessions</div>
        ) : (
          sessionList.map((s) => (
            <div
              key={s.id}
              className={`session-history__item ${s.id === activeSessionId ? 'session-history__item--active' : ''}`}
              onClick={() => loadSession(s.id)}
            >
              <div className="session-history__item-top">
                <span className="session-history__item-title">{s.title}</span>
                <span className="session-history__item-date">{formatDate(s.updated)}</span>
              </div>
              <div className="session-history__item-bottom">
                <span className="session-history__item-preview">{s.preview}</span>
                <button
                  className="session-history__item-delete"
                  onClick={(e) => { e.stopPropagation(); removeSession(s.id); }}
                  title="Delete session"
                >
                  &times;
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
