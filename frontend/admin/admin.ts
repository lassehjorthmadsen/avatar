/* =============================================================================
   AVATAR — Admin Dashboard
   Handles: login, conversation inbox, thread view, human reply,
   keyboard navigation, search/filter, polling, theme toggle.
   ============================================================================= */

// ---- Types ----

interface Conversation {
  conversation_id: string;
  conversation_name: string | null;
  last_message_at: string;
  snippet: string;
  initials: string;
  has_unread: boolean;
  needs_attention: boolean;
}

interface Message {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  created_at: string;
  is_read: boolean;
  needs_attention: boolean;
  tool_use: string | null;
}

// ---- State ----

let ownerName = 'You';
let conversations: Conversation[] = [];
let filteredConversations: Conversation[] = [];
let activeConvoId: string | null = null;
let activeConvoIndex = -1;
let currentFilter: 'all' | 'attention' | 'unread' = 'all';
let searchQuery = '';
let pollTimer: ReturnType<typeof setTimeout> | null = null;
const POLL_INTERVAL = 10_000;

// ---- DOM ----

const loginScreen = document.getElementById('login-screen') as HTMLDivElement;
const loginForm = document.getElementById('login-form') as HTMLFormElement;
const loginPassword = document.getElementById('login-password') as HTMLInputElement;
const loginError = document.getElementById('login-error') as HTMLParagraphElement;
const dashboard = document.getElementById('dashboard') as HTMLDivElement;
// sidebar element reference (used by mobile layout transitions)
void document.getElementById('sidebar');
const convoList = document.getElementById('convo-list') as HTMLDivElement;
const convoCount = document.getElementById('convo-count') as HTMLSpanElement;
const attentionCount = document.getElementById('attention-count') as HTMLSpanElement;
const unreadCount = document.getElementById('unread-count') as HTMLSpanElement;
const searchInput = document.getElementById('search-input') as HTMLInputElement;
const mainPanel = document.getElementById('main-panel') as HTMLElement;
const emptyState = document.getElementById('empty-state') as HTMLDivElement;
const threadView = document.getElementById('thread-view') as HTMLDivElement;
const threadInner = document.getElementById('thread-inner') as HTMLDivElement;
const threadInitials = document.getElementById('thread-initials') as HTMLSpanElement;
const threadName = document.getElementById('thread-name') as HTMLSpanElement;
const threadSub = document.getElementById('thread-sub') as HTMLSpanElement;
const attnFlag = document.getElementById('attn-flag') as HTMLSpanElement;
const replyInput = document.getElementById('reply-input') as HTMLTextAreaElement;
const replySendBtn = document.getElementById('reply-send-btn') as HTMLButtonElement;
const backBtn = document.getElementById('back-btn') as HTMLButtonElement;
const themeToggle = document.getElementById('theme-toggle') as HTMLButtonElement;
const logoutBtn = document.getElementById('logout-btn') as HTMLButtonElement;
const ownerNameChip = document.getElementById('owner-name-chip') as HTMLSpanElement;
const postingAsName = document.getElementById('posting-as-name') as HTMLElement;
const toastEl = document.getElementById('toast') as HTMLDivElement;

// ---- Utilities ----

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getInitials(name: string | null): string {
  if (!name || !name.trim()) return '??';
  return name
    .trim()
    .split(/\s+/)
    .map(w => w[0].toUpperCase())
    .slice(0, 2)
    .join('');
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const dayMs = 86_400_000;

  if (diff < dayMs && d.getDate() === now.getDate()) {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  if (diff < 2 * dayMs) return 'Yesterday';
  if (diff < 7 * dayMs) return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatFullTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function renderMarkdown(text: string): string {
  let html = escapeHtml(text);
  html = html.replace(/```[\w]*\n?([\s\S]*?)```/g, (_m, code) => `<pre><code>${code.trim()}</code></pre>`);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
  html = html.replace(/(?<![*_])\*([^*]+)\*(?![*_])/g, '<em>$1</em>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const paragraphs = html.split(/\n\n+/);
  html = paragraphs
    .map(p => {
      const t = p.trim();
      if (!t) return '';
      if (/^<(ul|ol|pre|blockquote)/.test(t)) return t;
      return `<p>${t.replace(/\n/g, '<br>')}</p>`;
    })
    .filter(Boolean)
    .join('\n');
  return html;
}

function showToast(msg: string, isError = false, ms = 4000): void {
  toastEl.textContent = msg;
  toastEl.className = 'toast' + (isError ? ' toast--error' : '');
  toastEl.style.display = 'block';
  setTimeout(() => { toastEl.style.display = 'none'; }, ms);
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
  if (saved) document.documentElement.setAttribute('data-theme', saved);
  syncThemeIcon();
}

themeToggle.addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('avatar-theme', next);
  syncThemeIcon();
});

// ---- Auth ----

async function checkAuth(): Promise<boolean> {
  try {
    const res = await fetch('/admin/api/check', { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      ownerName = data.owner_name || 'You';
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function login(password: string): Promise<boolean> {
  try {
    const res = await fetch('/admin/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      const data = await res.json();
      ownerName = data.owner_name || 'You';
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function logout(): Promise<void> {
  await fetch('/admin/api/logout', { method: 'POST', credentials: 'include' });
  dashboard.style.display = 'none';
  loginScreen.style.display = 'flex';
  loginPassword.value = '';
  loginPassword.focus();
  stopPolling();
}

// ---- Inbox ----

async function fetchConversations(): Promise<void> {
  try {
    const res = await fetch('/admin/api/conversations', { credentials: 'include' });
    if (!res.ok) {
      if (res.status === 401) { logout(); return; }
      return;
    }
    const data = await res.json();
    conversations = data.conversations || [];
    applyFilters();
    updateCounts();
  } catch {
    // Silently ignore
  }
}

function updateCounts(): void {
  convoCount.textContent = String(conversations.length);
  const attn = conversations.filter(c => c.needs_attention).length;
  const unread = conversations.filter(c => c.has_unread).length;
  attentionCount.textContent = attn > 0 ? ` · ${attn}` : '';
  unreadCount.textContent = unread > 0 ? ` · ${unread}` : '';
}

function applyFilters(): void {
  let list = conversations;
  if (currentFilter === 'attention') {
    list = list.filter(c => c.needs_attention);
  } else if (currentFilter === 'unread') {
    list = list.filter(c => c.has_unread);
  }
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(c =>
      (c.conversation_name || '').toLowerCase().includes(q) ||
      (c.snippet || '').toLowerCase().includes(q)
    );
  }
  filteredConversations = list;
  renderInbox();
}

function renderInbox(): void {
  convoList.innerHTML = '';
  for (let i = 0; i < filteredConversations.length; i++) {
    const c = filteredConversations[i];
    const el = document.createElement('div');
    const classes = ['convo-item'];
    if (c.conversation_id === activeConvoId) classes.push('is-active');
    if (c.has_unread) classes.push('is-unread');
    if (c.needs_attention) classes.push('is-attention');
    el.className = classes.join(' ');
    el.dataset.id = c.conversation_id;
    el.dataset.index = String(i);

    const name = c.conversation_name || 'Anonymous';
    const initials = c.initials || getInitials(c.conversation_name);
    const time = formatTime(c.last_message_at);
    const preview = (c.snippet || '').slice(0, 80);

    let statusHtml = '';
    if (c.needs_attention) {
      statusHtml = `<span class="badge badge--attention"><svg class="icon" style="width:11px;height:11px"><use href="/icons.svg#i-spark"/></svg> Needs you</span>`;
    } else if (c.has_unread) {
      statusHtml = `<span class="badge badge--dot"></span>`;
    } else {
      statusHtml = `<svg class="icon icon--sm" style="color:var(--positive)"><use href="/icons.svg#i-check2"/></svg>`;
    }

    el.innerHTML = `
      <span class="avatar-initials">${escapeHtml(initials)}</span>
      <div class="convo-main">
        <div class="convo-top"><span class="convo-name">${escapeHtml(name)}</span></div>
        <div class="convo-preview">${escapeHtml(preview)}</div>
      </div>
      <div class="convo-side">
        <span class="msg-time">${time}</span>
        ${statusHtml}
      </div>
    `;

    el.addEventListener('click', () => openConversation(c.conversation_id, i));
    convoList.appendChild(el);
  }
}

// ---- Thread ----

async function openConversation(convoId: string, index: number): Promise<void> {
  activeConvoId = convoId;
  activeConvoIndex = index;

  // Mark active in inbox
  convoList.querySelectorAll('.convo-item').forEach(el => {
    el.classList.toggle('is-active', (el as HTMLElement).dataset.id === convoId);
  });

  // Show thread panel (mobile: slide in)
  emptyState.style.display = 'none';
  threadView.style.display = 'flex';
  mainPanel.classList.add('is-open');

  // Fetch thread messages
  try {
    const res = await fetch(`/admin/api/conversations/${convoId}`, { credentials: 'include' });
    if (!res.ok) {
      if (res.status === 401) { logout(); return; }
      showToast('Failed to load conversation', true);
      return;
    }
    const data: { messages: Message[] } = await res.json();
    renderThread(data.messages);

    // Update header
    const convo = filteredConversations[index];
    if (convo) {
      const name = convo.conversation_name || 'Anonymous';
      threadInitials.textContent = convo.initials || getInitials(convo.conversation_name);
      threadName.textContent = name;
      threadSub.textContent = `${data.messages.length} messages · started ${formatTime(data.messages[0]?.created_at || convo.last_message_at)}`;
      attnFlag.style.display = convo.needs_attention ? 'inline-flex' : 'none';

      // Update composer placeholder
      replyInput.placeholder = `Write a message to ${name}…`;

      // Mark as read in local state
      convo.has_unread = false;
      convo.needs_attention = false;
      applyFilters();
    }
  } catch {
    showToast('Connection error', true);
  }

  replyInput.focus({ preventScroll: true });
}

function renderThread(messages: Message[]): void {
  threadInner.innerHTML = '';

  for (const msg of messages) {
    const el = document.createElement('div');
    const time = formatFullTime(msg.created_at);

    if (msg.role === 'user') {
      el.className = 'msg msg--visitor';
      el.innerHTML = `
        <span class="avatar-initials">V</span>
        <div class="msg-body">
          <div class="msg-meta"><span class="msg-time">${time}</span></div>
          <div class="bubble">${renderMarkdown(msg.content)}</div>
        </div>
      `;
    } else if (msg.role === 'human') {
      el.className = 'msg msg--human';
      el.innerHTML = `
        <div class="avatar avatar-human" style="background-image:url('/assets/avatar-human.png')">
          <span class="spark-badge"><svg class="icon"><use href="/icons.svg#i-spark"/></svg></span>
        </div>
        <div class="msg-body">
          <div class="msg-meta">
            <span class="human-tag"><svg class="icon"><use href="/icons.svg#i-live"/></svg> You · sent to visitor</span>
            <span class="msg-time">${time}</span>
          </div>
          <div class="bubble">${renderMarkdown(msg.content)}</div>
        </div>
      `;
    } else {
      // assistant / avatar
      let toolHtml = '';
      if (msg.tool_use) {
        toolHtml = `<div class="tool-status is-done"><svg class="icon"><use href="/icons.svg#i-check"/></svg> ${escapeHtml(msg.tool_use)}</div>`;
      }
      el.className = 'msg msg--avatar';
      el.innerHTML = `
        <div class="avatar avatar-twin" style="background-image:url('/assets/avatar-robot-round.png')"></div>
        <div class="msg-body">
          <div class="msg-meta"><span class="msg-name">Avatar</span><span class="msg-time">${time}</span></div>
          ${toolHtml}
          <div class="bubble">${renderMarkdown(msg.content)}</div>
        </div>
      `;
    }

    threadInner.appendChild(el);
  }

  // Scroll to bottom
  const thread = document.getElementById('thread') as HTMLDivElement;
  requestAnimationFrame(() => { thread.scrollTop = thread.scrollHeight; });
}

// ---- Reply ----

async function sendReply(): Promise<void> {
  const text = replyInput.value.trim();
  if (!text || !activeConvoId) return;

  replyInput.value = '';
  autoResizeReply();

  try {
    const res = await fetch(`/admin/api/conversations/${activeConvoId}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ content: text }),
    });
    if (!res.ok) {
      if (res.status === 401) { logout(); return; }
      showToast('Failed to send message', true);
      return;
    }
    const data: { message: Message } = await res.json();

    // Append to thread
    const el = document.createElement('div');
    el.className = 'msg msg--human';
    el.innerHTML = `
      <div class="avatar avatar-human" style="background-image:url('/assets/avatar-human.png')">
        <span class="spark-badge"><svg class="icon"><use href="/icons.svg#i-spark"/></svg></span>
      </div>
      <div class="msg-body">
        <div class="msg-meta">
          <span class="human-tag"><svg class="icon"><use href="/icons.svg#i-live"/></svg> You · sent to visitor</span>
          <span class="msg-time">${formatFullTime(data.message.created_at)}</span>
        </div>
        <div class="bubble">${renderMarkdown(data.message.content)}</div>
      </div>
    `;
    threadInner.appendChild(el);
    const thread = document.getElementById('thread') as HTMLDivElement;
    thread.scrollTop = thread.scrollHeight;

    showToast('Message sent');
  } catch {
    showToast('Connection error — try again', true);
  }

  replyInput.focus({ preventScroll: true });
}

function autoResizeReply(): void {
  replyInput.style.height = 'auto';
  replyInput.style.height = Math.min(replyInput.scrollHeight, 160) + 'px';
}

replyInput.addEventListener('input', autoResizeReply);

replyInput.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendReply();
  }
});

replySendBtn.addEventListener('click', () => sendReply());

// ---- Navigation (arrow keys) ----

document.addEventListener('keydown', (e: KeyboardEvent) => {
  // Only nav when not focused on text inputs
  if (document.activeElement === replyInput || document.activeElement === searchInput) return;
  if (document.activeElement === loginPassword) return;

  if (e.key === 'ArrowDown' || e.key === 'j') {
    e.preventDefault();
    navigateInbox(1);
  } else if (e.key === 'ArrowUp' || e.key === 'k') {
    e.preventDefault();
    navigateInbox(-1);
  }
});

function navigateInbox(delta: number): void {
  if (filteredConversations.length === 0) return;
  let next = activeConvoIndex + delta;
  if (next < 0) next = 0;
  if (next >= filteredConversations.length) next = filteredConversations.length - 1;
  const convo = filteredConversations[next];
  if (convo) openConversation(convo.conversation_id, next);
}

// ---- Back button (mobile) ----

backBtn.addEventListener('click', () => {
  mainPanel.classList.remove('is-open');
  activeConvoId = null;
  activeConvoIndex = -1;
});

// ---- Search ----

searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value.trim();
  applyFilters();
});

// ---- Filter chips ----

document.querySelectorAll('.filter-chip').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('is-on'));
    btn.classList.add('is-on');
    currentFilter = (btn as HTMLElement).dataset.filter as typeof currentFilter;
    applyFilters();
  });
});

// ---- Logout ----

logoutBtn.addEventListener('click', () => logout());

// ---- Polling ----

function startPolling(): void {
  stopPolling();
  pollTimer = setInterval(() => fetchConversations(), POLL_INTERVAL);
}

function stopPolling(): void {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// ---- Login form ----

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';
  const ok = await login(loginPassword.value);
  if (ok) {
    showDashboard();
  } else {
    loginError.textContent = 'Invalid password';
    loginPassword.select();
  }
});

// ---- Show dashboard ----

function showDashboard(): void {
  loginScreen.style.display = 'none';
  dashboard.style.display = 'grid';
  ownerNameChip.textContent = ownerName;
  postingAsName.textContent = ownerName;
  fetchConversations();
  startPolling();
}

// ---- Init ----

async function init(): Promise<void> {
  initTheme();

  const authed = await checkAuth();
  if (authed) {
    showDashboard();
  } else {
    loginScreen.style.display = 'flex';
    loginPassword.focus();
  }
}

init();
