/* =============================================================================
   AVATAR — Visitor Chat
   Handles: config load, conversation persistence, message submission,
   SSE streaming, instant Qn answers, human message polling, theme toggle,
   Keep-chat toggle, Reset, deep-link ?q=N, markdown rendering.
   ============================================================================= */

// ---- Types ----

interface ApiConfig {
  owner_name: string;
  /** `faq` is the FAQ's number, as served by /api/config (see get_faq_queries). */
  faq_queries: { faq: number; query: string }[];
}

interface Message {
  id?: string;
  /** Roles as stored in the database: the visitor is 'user', the twin is 'assistant'. */
  role: 'user' | 'assistant' | 'human';
  content: string;
  created_at?: string;
  is_instant?: boolean;
  instant_n?: number;
}

interface SseEvent {
  type: 'text' | 'tool_start' | 'tool_end' | 'done' | 'error';
  content?: string;
  tool?: string;
  message?: Message;
  error?: string;
}

// ---- Constants ----

const COOKIE_NAME = 'avatar_conv_id';
const NAME_COOKIE = 'avatar_visitor_name';
const POLL_FAST_MS = 10_000;
const POLL_SLOW_MS = 60_000;
const INACTIVITY_THRESHOLD_MS = 5 * 60 * 1_000;
const MAX_MSG_LENGTH = 20_000;

// ---- State ----

let conversationId: string = '';
let ownerName: string = 'the owner';
let visitorName: string = '';
let keepChat: boolean = true;
let lastActivityTime: number = Date.now();
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let isStreaming: boolean = false;
let lastMessageCount: number = 0;

// ---- DOM references ----

const convoEl = document.getElementById('convo') as HTMLDivElement;
const convoInner = document.getElementById('convo-inner') as HTMLDivElement;
const introCard = document.getElementById('intro-card') as HTMLDivElement;
const suggestRow = document.getElementById('suggest-row') as HTMLDivElement;
const msgInput = document.getElementById('msg-input') as HTMLTextAreaElement;
const sendBtn = document.getElementById('send-btn') as HTMLButtonElement;
const keepChatToggle = document.getElementById('keep-chat-toggle') as HTMLInputElement;
const resetBtn = document.getElementById('reset-btn') as HTMLButtonElement;
const themeToggle = document.getElementById('theme-toggle') as HTMLButtonElement;
const brandSub = document.getElementById('brand-sub') as HTMLDivElement;
const introOwnerPossessive = document.getElementById('intro-owner-possessive') as HTMLSpanElement;
const introDesc = document.getElementById('intro-desc') as HTMLParagraphElement;
const typingIndicator = document.getElementById('typing-indicator') as HTMLDivElement;
const visitorNameInput = document.getElementById('visitor-name') as HTMLInputElement;
const toastEl = document.getElementById('toast') as HTMLDivElement;

// ---- Utilities ----

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

function setCookie(name: string, value: string, days = 365): void {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

function deleteCookie(name: string): void {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax`;
}

function formatTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function getInitials(name: string): string {
  if (!name.trim()) return '?';
  return name
    .trim()
    .split(/\s+/)
    .map((w) => w[0].toUpperCase())
    .slice(0, 2)
    .join('');
}

// Simple regex-based markdown renderer (no external deps)
function renderMarkdown(text: string): string {
  // Escape HTML first (prevent XSS)
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks (before inline code)
  html = html.replace(/```[\w]*\n?([\s\S]*?)```/g, (_m, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold **text** or __text__
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');

  // Italic *text* or _text_ (not inside words)
  html = html.replace(/(?<![*_])\*([^*]+)\*(?![*_])/g, '<em>$1</em>');
  html = html.replace(/(?<!_)_([^_]+)_(?!_)/g, '<em>$1</em>');

  // Links [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Unordered list items
  html = html.replace(/((?:^|\n)[*-] .+)+/g, (block) => {
    const items = block
      .trim()
      .split('\n')
      .map((line) => `<li>${line.replace(/^[*-] /, '')}</li>`)
      .join('');
    return `\n<ul>${items}</ul>`;
  });

  // Ordered list items
  html = html.replace(/((?:^|\n)\d+\. .+)+/g, (block) => {
    const items = block
      .trim()
      .split('\n')
      .map((line) => `<li>${line.replace(/^\d+\. /, '')}</li>`)
      .join('');
    return `\n<ol>${items}</ol>`;
  });

  // Paragraphs: split on double newlines
  const paragraphs = html.split(/\n\n+/);
  html = paragraphs
    .map((p) => {
      const trimmed = p.trim();
      if (!trimmed) return '';
      // Don't wrap already-block elements
      if (/^<(ul|ol|pre|blockquote)/.test(trimmed)) return trimmed;
      // Replace single newlines with <br>
      return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
    })
    .filter(Boolean)
    .join('\n');

  return html;
}

function showToast(msg: string, isError = false, durationMs = 4000): void {
  toastEl.textContent = msg;
  toastEl.className = 'toast' + (isError ? ' toast--error' : '');
  toastEl.style.display = 'block';
  setTimeout(() => {
    toastEl.style.display = 'none';
  }, durationMs);
}

function scrollToBottom(): void {
  convoEl.scrollTop = convoEl.scrollHeight;
}

// ---- Theme ----

function syncThemeIcon(): void {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const moon = themeToggle.querySelector('.theme-moon') as SVGElement;
  const sun = themeToggle.querySelector('.theme-sun') as SVGElement;
  if (moon) moon.style.display = dark ? '' : 'none';
  if (sun) sun.style.display = dark ? 'none' : '';
}

function initTheme(): void {
  const saved = localStorage.getItem('avatar-theme');
  if (saved) {
    document.documentElement.setAttribute('data-theme', saved);
  }
  syncThemeIcon();
}

themeToggle.addEventListener('click', () => {
  const next =
    document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('avatar-theme', next);
  syncThemeIcon();
});

// ---- Render messages ----

// makeAvatarBubble is available for streaming use (creates empty bubble to fill)
function _makeAvatarBubble(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'msg msg--avatar';
  el.innerHTML = `
    <div class="avatar avatar-twin" style="background-image:url('/assets/avatar-robot-round.png')"></div>
    <div class="msg-body">
      <div class="msg-meta">
        <span class="msg-name">Avatar</span>
        <span class="msg-time">${formatTime(new Date())}</span>
      </div>
      <div class="bubble"></div>
    </div>
  `;
  return el;
}
void _makeAvatarBubble;

function renderVisitorMessage(content: string, timestamp?: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'msg msg--visitor';
  const initials = getInitials(visitorName || 'You');
  const time = timestamp ? formatTime(timestamp) : formatTime(new Date());
  el.innerHTML = `
    <span class="avatar-initials">${initials}</span>
    <div class="msg-body">
      <div class="msg-meta"><span class="msg-time">${time}</span></div>
      <div class="bubble"><p>${content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p></div>
    </div>
  `;
  return el;
}

function renderAvatarMessage(
  content: string,
  timestamp?: string,
  toolName?: string,
  isInstant?: boolean,
  instantN?: number
): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'msg msg--avatar';
  const time = timestamp ? formatTime(timestamp) : formatTime(new Date());

  let toolHtml = '';
  if (toolName) {
    toolHtml = `<div class="tool-status is-done">
      <svg class="icon"><use href="/icons.svg#i-check"/></svg> Used ${toolName}
    </div>`;
  }

  let instantHtml = '';
  if (isInstant && instantN !== undefined) {
    instantHtml = `<span class="instant-tag">instant · Q${instantN}</span>`;
  }

  el.innerHTML = `
    <div class="avatar avatar-twin" style="background-image:url('/assets/avatar-robot-round.png')"></div>
    <div class="msg-body">
      <div class="msg-meta">
        <span class="msg-name">Avatar</span>
        ${instantHtml}
        <span class="msg-time">${time}</span>
      </div>
      ${toolHtml}
      <div class="bubble">${renderMarkdown(content)}</div>
    </div>
  `;
  return el;
}

function renderHumanMessage(content: string, timestamp?: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'msg msg--human';
  const time = timestamp ? formatTime(timestamp) : formatTime(new Date());
  el.innerHTML = `
    <div class="avatar avatar-human" style="background-image:url('/assets/avatar-human.png')">
      <span class="spark-badge"><svg class="icon"><use href="/icons.svg#i-spark"/></svg></span>
    </div>
    <div class="msg-body">
      <div class="msg-meta">
        <span class="human-tag">
          <svg class="icon"><use href="/icons.svg#i-live"/></svg> ${escapeHtml(ownerName)} · live
        </span>
        <span class="msg-time">${time}</span>
      </div>
      <div class="bubble">${renderMarkdown(content)}</div>
    </div>
  `;
  return el;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function appendMessage(el: HTMLElement): void {
  // Remove intro card when first message arrives
  if (introCard && introCard.parentNode === convoInner) {
    convoInner.removeChild(introCard);
  }
  convoInner.appendChild(el);
  scrollToBottom();
}

function renderHistory(messages: Message[]): void {
  // Clear everything except intro
  while (convoInner.firstChild) {
    convoInner.removeChild(convoInner.firstChild);
  }

  if (messages.length === 0) {
    convoInner.appendChild(introCard);
    return;
  }

  for (const msg of messages) {
    let el: HTMLDivElement;
    // The database stores the visitor's role as 'user'.
    if (msg.role === 'user') {
      el = renderVisitorMessage(msg.content, msg.created_at);
    } else if (msg.role === 'human') {
      el = renderHumanMessage(msg.content, msg.created_at);
    } else {
      el = renderAvatarMessage(
        msg.content,
        msg.created_at,
        undefined,
        msg.is_instant,
        msg.instant_n
      );
    }
    convoInner.appendChild(el);
  }
  lastMessageCount = messages.length;
  scrollToBottom();
}

// ---- Composer placeholder ----

/** The full placeholder carries the Qn tip, but a phone-width composer is one
 *  row tall, so anything that wraps is clipped mid-word. On narrow screens drop
 *  the tip (it still shows in the hint row below) and use the owner's first
 *  name, since a full name alone already overflows at 390px. */
function setComposerPlaceholder(): void {
  if (!msgInput) return;
  if (window.matchMedia('(max-width: 560px)').matches) {
    const firstName = ownerName.trim().split(/\s+/)[0];
    msgInput.placeholder = `Message ${firstName}'s twin…`;
  } else {
    msgInput.placeholder = `Message ${ownerName}'s twin…  (type "Q2" for an instant answer)`;
  }
}

window.addEventListener('resize', setComposerPlaceholder);

// ---- Config loading ----

async function loadConfig(): Promise<void> {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error('Config fetch failed');
    const cfg: ApiConfig = await res.json();
    ownerName = cfg.owner_name || 'the owner';

    // Update title
    document.title = `Avatar — ${ownerName}`;

    // Update brand sub
    if (brandSub) brandSub.textContent = `${ownerName} · digital twin`;

    // Update intro
    if (introOwnerPossessive) {
      // e.g. "Ed's" or if ending in s, "Ed's"
      const possessive = ownerName.endsWith('s') ? `${ownerName}'` : `${ownerName}'s`;
      introOwnerPossessive.textContent = possessive;
    }

    if (introDesc) {
      introDesc.textContent = `I know ${ownerName}'s background, work, and ideas. I can also put you in touch directly.`;
    }

    // Update composer placeholder
    setComposerPlaceholder();

    // Build suggest chips from first 3 FAQ queries
    if (suggestRow && cfg.faq_queries && cfg.faq_queries.length > 0) {
      suggestRow.innerHTML = '';
      const shown = cfg.faq_queries.slice(0, 3);
      for (const faq of shown) {
        const btn = document.createElement('button');
        btn.className = 'chip';
        btn.textContent = faq.query;
        btn.addEventListener('click', () => {
          submitMessage(faq.query);
        });
        suggestRow.appendChild(btn);
      }
    }
  } catch (_e) {
    // Silently ignore — use defaults
  }
}

// ---- Conversation ID & persistence ----

function initConversation(): string {
  keepChat = keepChatToggle.checked;

  if (keepChat) {
    const existing = getCookie(COOKIE_NAME);
    if (existing) return existing;
  }

  const id = generateUUID();
  if (keepChat) setCookie(COOKIE_NAME, id);
  return id;
}

function resetConversation(): void {
  deleteCookie(COOKIE_NAME);
  conversationId = generateUUID();
  if (keepChatToggle.checked) setCookie(COOKIE_NAME, conversationId);

  // Clear messages, show intro
  while (convoInner.firstChild) {
    convoInner.removeChild(convoInner.firstChild);
  }
  convoInner.appendChild(introCard);
  lastMessageCount = 0;
  scrollToBottom();
  msgInput.focus({ preventScroll: true });
}

keepChatToggle.addEventListener('change', () => {
  keepChat = keepChatToggle.checked;
  if (keepChat) {
    setCookie(COOKIE_NAME, conversationId);
  } else {
    deleteCookie(COOKIE_NAME);
  }
});

resetBtn.addEventListener('click', () => {
  if (!confirm('Reset and start a fresh conversation?')) return;
  resetConversation();
});

// ---- Visitor name ----

function initVisitorName(): void {
  const saved = getCookie(NAME_COOKIE);
  if (saved) {
    visitorName = saved;
    visitorNameInput.value = saved;
  }
}

visitorNameInput.addEventListener('input', () => {
  visitorName = visitorNameInput.value.trim();
  setCookie(NAME_COOKIE, visitorName, 365);
});

// ---- Load history ----

async function loadHistory(): Promise<void> {
  if (!conversationId) return;
  try {
    const res = await fetch(`/api/conversation/${conversationId}`);
    if (!res.ok) {
      if (res.status === 404) return; // No history yet
      return;
    }
    const data: { messages: Message[] } = await res.json();
    if (data.messages && data.messages.length > 0) {
      renderHistory(data.messages);
    }
  } catch (_e) {
    // Silently ignore
  }
}

// ---- Qn instant answer detection ----

function isQnShortcut(text: string): number | null {
  const match = text.trim().match(/^[Qq](\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

// ---- SSE streaming ----

async function streamAvatarReply(userContent: string): Promise<void> {
  isStreaming = true;
  sendBtn.disabled = true;
  typingIndicator.style.display = 'inline-flex';

  // Create streaming avatar message element
  const msgEl = document.createElement('div');
  msgEl.className = 'msg msg--avatar msg--streaming';
  msgEl.innerHTML = `
    <div class="avatar avatar-twin" style="background-image:url('/assets/avatar-robot-round.png')"></div>
    <div class="msg-body">
      <div class="msg-meta">
        <span class="msg-name">Avatar</span>
        <span class="msg-time">${formatTime(new Date())}</span>
      </div>
      <div class="bubble"></div>
    </div>
  `;

  const bubble = msgEl.querySelector('.bubble') as HTMLDivElement;
  void msgEl.querySelector('.msg-meta'); // metaEl reserved for future tool status injection

  appendMessage(msgEl);

  let accumulatedText = '';
  let currentToolEl: HTMLDivElement | null = null;

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: conversationId,
        message: userContent,
        visitor_name: visitorName || null,
      }),
    });

    if (response.status === 429) {
      msgEl.remove();
      showToast("You're sending messages too quickly — please wait a moment.", true);
      typingIndicator.style.display = 'none';
      sendBtn.disabled = false;
      isStreaming = false;
      msgInput.focus({ preventScroll: true });
      return;
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    // Check if it's a non-streaming (instant) JSON response
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data: { message: Message } = await response.json();
      msgEl.remove();
      typingIndicator.style.display = 'none';

      const finalEl = renderAvatarMessage(
        data.message.content,
        data.message.created_at,
        undefined,
        data.message.is_instant,
        data.message.instant_n
      );
      appendMessage(finalEl);
      lastMessageCount += 1;
      sendBtn.disabled = false;
      isStreaming = false;
      msgInput.focus({ preventScroll: true });
      return;
    }

    // SSE streaming
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') continue;

        let evt: SseEvent;
        try {
          evt = JSON.parse(raw);
        } catch {
          continue;
        }

        if (evt.type === 'text' && evt.content) {
          accumulatedText += evt.content;
          bubble.innerHTML = renderMarkdown(accumulatedText);
          scrollToBottom();
        } else if (evt.type === 'tool_start' && evt.tool) {
          // Show in-progress tool status
          currentToolEl = document.createElement('div');
          currentToolEl.className = 'tool-status';
          currentToolEl.innerHTML = `
            <svg class="icon"><use href="/icons.svg#i-tool"/></svg>
            <span class="dots"></span>${evt.tool}
          `;
          msgEl.querySelector('.msg-body')!.insertBefore(currentToolEl, bubble);
          scrollToBottom();
        } else if (evt.type === 'tool_end') {
          // Update tool status to done
          if (currentToolEl) {
            const toolName = currentToolEl.textContent?.trim().replace(/…$/, '').trim() || 'tool';
            currentToolEl.className = 'tool-status is-done';
            currentToolEl.innerHTML = `
              <svg class="icon"><use href="/icons.svg#i-check"/></svg> Used ${toolName}
            `;
            currentToolEl = null;
          }
        } else if (evt.type === 'done' && evt.message) {
          // Replace streaming element with final rendered message
          msgEl.remove();
          typingIndicator.style.display = 'none';

          const finalEl = renderAvatarMessage(
            evt.message.content,
            evt.message.created_at,
            undefined,
            evt.message.is_instant,
            evt.message.instant_n
          );
          appendMessage(finalEl);
          lastMessageCount += 1;
          break;
        } else if (evt.type === 'error') {
          msgEl.remove();
          showToast(evt.error || 'Something went wrong. Please try again.', true);
          break;
        }
      }
    }
  } catch (err) {
    msgEl.remove();
    showToast('Connection error — please check your network and try again.', true);
    console.error('Stream error:', err);
  } finally {
    typingIndicator.style.display = 'none';
    // Remove streaming class (removes cursor blink)
    msgEl.classList?.remove('msg--streaming');
    sendBtn.disabled = false;
    isStreaming = false;
    msgInput.focus({ preventScroll: true });
  }
}

// ---- Instant Qn answer ----

async function fetchInstantAnswer(n: number, rawText: string): Promise<void> {
  isStreaming = true;
  sendBtn.disabled = true;
  typingIndicator.style.display = 'inline-flex';

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: conversationId,
        message: rawText,
        visitor_name: visitorName || null,
      }),
    });

    if (response.status === 429) {
      showToast("You're sending messages too quickly — please wait a moment.", true);
      return;
    }

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data: { message: Message } = await response.json();
      const el = renderAvatarMessage(
        data.message.content,
        data.message.created_at,
        undefined,
        data.message.is_instant ?? true,
        data.message.instant_n ?? n
      );
      appendMessage(el);
      lastMessageCount += 1;
    } else {
      // Fallback: treat as streaming anyway
      await streamAvatarReply(rawText);
      return;
    }
  } catch (err) {
    showToast('Could not fetch the answer — please try again.', true);
    console.error('Instant answer error:', err);
  } finally {
    typingIndicator.style.display = 'none';
    sendBtn.disabled = false;
    isStreaming = false;
    msgInput.focus({ preventScroll: true });
  }
}

// ---- Submit a message ----

async function submitMessage(text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed || isStreaming) return;

  // Clamp to 20k chars (abuse guard — server also enforces)
  const content = trimmed.length > MAX_MSG_LENGTH ? trimmed.slice(0, MAX_MSG_LENGTH) : trimmed;

  // Clear input first
  msgInput.value = '';
  autoResizeTextarea();

  // Record activity
  lastActivityTime = Date.now();

  // Render visitor's message
  const visitorEl = renderVisitorMessage(content);
  appendMessage(visitorEl);
  lastMessageCount += 1;

  // Detect Qn shortcut
  const qn = isQnShortcut(content);
  if (qn !== null) {
    await fetchInstantAnswer(qn, content);
  } else {
    await streamAvatarReply(content);
  }
}

// ---- Composer input handling ----

function autoResizeTextarea(): void {
  msgInput.style.height = 'auto';
  msgInput.style.height = Math.min(msgInput.scrollHeight, 160) + 'px';
}

msgInput.addEventListener('input', autoResizeTextarea);

msgInput.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submitMessage(msgInput.value);
  }
});

sendBtn.addEventListener('click', () => {
  submitMessage(msgInput.value);
});

// ---- Human message polling ----

async function pollForHumanMessages(): Promise<void> {
  if (!conversationId) return;

  try {
    const res = await fetch(`/api/conversation/${conversationId}`);
    if (!res.ok) return;
    const data: { messages: Message[] } = await res.json();
    if (!data.messages) return;

    if (data.messages.length > lastMessageCount) {
      // New messages arrived — render only the new ones
      const newMsgs = data.messages.slice(lastMessageCount);
      for (const msg of newMsgs) {
        if (msg.role === 'human') {
          const el = renderHumanMessage(msg.content, msg.created_at);
          appendMessage(el);
        }
        // Skip visitor and avatar — they're already rendered
      }
      lastMessageCount = data.messages.length;
    }
  } catch (_e) {
    // Silently ignore
  }
}

function scheduleNextPoll(): void {
  if (pollTimer) clearTimeout(pollTimer);
  const elapsed = Date.now() - lastActivityTime;
  const interval = elapsed > INACTIVITY_THRESHOLD_MS ? POLL_SLOW_MS : POLL_FAST_MS;
  pollTimer = setTimeout(async () => {
    await pollForHumanMessages();
    scheduleNextPoll();
  }, interval);
}

// ---- Deep link ?q=N ----

function handleDeepLink(): void {
  const params = new URLSearchParams(window.location.search);
  const qParam = params.get('q');
  if (qParam !== null) {
    const n = parseInt(qParam, 10);
    if (!isNaN(n) && n > 0) {
      // Remove the ?q= from URL without reload
      const url = new URL(window.location.href);
      url.searchParams.delete('q');
      window.history.replaceState(null, '', url.toString());

      // Auto-submit after a brief tick (allows DOM to settle)
      setTimeout(() => {
        submitMessage(`Q${n}`);
      }, 150);
    }
  }
}

// ---- Init ----

async function init(): Promise<void> {
  // Apply theme immediately
  initTheme();

  // Visitor name
  initVisitorName();

  // Init conversation ID
  conversationId = initConversation();

  // Load config (owner name, FAQ queries)
  await loadConfig();

  // Load history if keep-chat is on
  if (keepChat) {
    await loadHistory();
  }

  // Handle deep link
  handleDeepLink();

  // Start polling for human messages
  scheduleNextPoll();

  // Focus composer
  msgInput.focus({ preventScroll: true });
}

init();
