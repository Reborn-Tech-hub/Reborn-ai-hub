(() => {
  'use strict';

  const AI_NAME = 'Reborn Ai';
  const AI_IMG = 'https://res.cloudinary.com/dqqyvozdw/image/upload/v1794930071/chr98vx6qbwip7ctfdys.png';
  const STORAGE_KEY = 'reborn_ai_chats_v2';
  const MAX_HISTORY = 20;
  const VIDEO_POLL_MS = 3000;
  const VIDEO_TIMEOUT_MS = 6 * 60 * 1000;

  const MODE_META = {
    chat:  { placeholder: 'Message Reborn Ai' },
    image: { placeholder: 'Describe the picture you want' },
    logo:  { placeholder: 'Describe your logo: brand name, style, colors' },
    video: { placeholder: 'Describe the video: subject, action, camera, mood' }
  };

  const SUGGESTIONS = [
    { icon: 'fa-bug', title: 'Debug my code', text: 'Find and fix an error fast', action: 'send', prompt: 'I have a bug in my code and I need help debugging it. What should I paste so you can find the problem fast?' },
    { icon: 'fa-pen-nib', title: 'Create a logo', text: 'Brand marks from a short brief', action: 'mode', mode: 'logo' },
    { icon: 'fa-film', title: 'Generate a video', text: 'Turn a prompt into a short clip', action: 'mode', mode: 'video' },
    { icon: 'fa-wand-magic-sparkles', title: 'Surprise me', text: 'Let me invent a prompt for you', action: 'surprise' }
  ];

  const $ = (id) => document.getElementById(id);
  const thread = $('thread');
  const chatEl = $('chat');
  const input = $('input');
  const sendBtn = $('sendBtn');
  const chatList = $('chatList');
  const sidebar = $('sidebar');
  const overlay = $('overlay');
  const surpriseBtn = $('surpriseBtn');

  let chats = [];
  let currentId = null;
  let loading = false;
  let mode = 'chat';

  /* ---------- Storage ---------- */
  function loadChats() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      chats = Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      chats = [];
    }
  }
  function saveChats() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(chats)); } catch (e) { /* storage full or blocked */ }
  }
  const getChat = () => chats.find((c) => c.id === currentId) || null;

  /* ---------- Helpers ---------- */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function formatTime(ts) { return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  function scrollBottom() { chatEl.scrollTop = chatEl.scrollHeight; }
  function isSafeUrl(u) { return typeof u === 'string' && /^https:\/\//i.test(u); }

  function makeAvatar(sizeClass) {
    const wrap = document.createElement('div');
    wrap.className = 'avatar ' + sizeClass;
    const img = new Image();
    img.alt = AI_NAME;
    img.onerror = () => { wrap.classList.add('fallback'); wrap.textContent = AI_NAME.charAt(0).toUpperCase(); };
    img.src = AI_IMG;
    wrap.appendChild(img);
    return wrap;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch (err) { return false; }
    }
  }

  async function postApi(body) {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* non-JSON response */ }
    if (!res.ok || !data) {
      throw new Error(data && data.error ? data.error : 'Something went wrong on my side.');
    }
    return data;
  }

  /* ---------- Markdown (safe) ---------- */
  function renderCodeBlock(block) {
    const lang = escapeHtml(block.lang || 'code');
    const isPrompt = (block.lang || '').toLowerCase() === 'prompt';
    const tools = (isPrompt
      ? '<button class="use-prompt" type="button" data-kind="image"><i class="fa-regular fa-image"></i><span>Make image</span></button>' +
        '<button class="use-prompt" type="button" data-kind="video"><i class="fa-solid fa-film"></i><span>Make video</span></button>'
      : '') +
      '<button class="copy-code" type="button"><i class="fa-regular fa-copy"></i><span>Copy code</span></button>';
    return '<div class="code-block"><div class="code-head"><span>' + lang + '</span><div class="code-tools">' + tools +
      '</div></div><pre><code>' + escapeHtml(block.code) + '</code></pre></div>';
  }

  function inline(s) {
    return s.split(/(`[^`\n]+`)/).map((part) => {
      if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) return '<code>' + part.slice(1, -1) + '</code>';
      return part.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    }).join('');
  }

  function formatMarkdown(text) {
    const blocks = [];
    let t = String(text).replace(/```([\w+#.-]*)[ \t]*\n?([\s\S]*?)```/g, (m, lang, code) => {
      blocks.push({ lang: lang, code: code.replace(/\n$/, '') });
      return '\u0000B' + (blocks.length - 1) + '\u0000';
    });
    t = escapeHtml(t);

    const out = [];
    let list = null;
    const closeList = () => { if (list) { out.push('</' + list + '>'); list = null; } };

    t.split('\n').forEach((line) => {
      const trimmed = line.trim();
      let m;
      if ((m = trimmed.match(/^\u0000B(\d+)\u0000$/))) { closeList(); out.push(renderCodeBlock(blocks[Number(m[1])])); return; }
      if (!trimmed) { closeList(); return; }
      if ((m = trimmed.match(/^(#{1,4})\s+(.*)$/))) {
        closeList();
        const lvl = Math.min(m[1].length + 1, 4);
        out.push('<h' + lvl + '>' + inline(m[2]) + '</h' + lvl + '>');
        return;
      }
      if ((m = trimmed.match(/^[-*\u2022]\s+(.*)$/))) {
        if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
        out.push('<li>' + inline(m[1]) + '</li>');
        return;
      }
      if ((m = trimmed.match(/^\d+[.)]\s+(.*)$/))) {
        if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
        out.push('<li>' + inline(m[1]) + '</li>');
        return;
      }
      closeList();
      out.push('<p>' + inline(trimmed) + '</p>');
    });
    closeList();

    return out.join('').replace(/\u0000B(\d+)\u0000/g, (m, i) => renderCodeBlock(blocks[Number(i)]));
  }

  /* ---------- Mode ---------- */
  function setMode(next) {
    if (!MODE_META[next]) return;
    mode = next;
    document.querySelectorAll('#modes .chip[data-mode]').forEach((c) => c.classList.toggle('active', c.dataset.mode === mode));
    input.placeholder = MODE_META[mode].placeholder;
    input.focus();
  }
  document.querySelectorAll('#modes .chip[data-mode]').forEach((c) => c.addEventListener('click', () => setMode(c.dataset.mode)));

  function detectKind(text) {
    const m = text.match(/^\s*(?:please\s+)?(?:can you\s+)?(?:generate|create|make|draw|design|render)\s+(?:me\s+)?(?:an?\s+|the\s+)?(?:ai\s+)?(?:[\w-]+\s+){0,2}?(image|picture|photo|illustration|logo|video|clip|animation)\b/i);
    if (!m) return null;
    const w = m[1].toLowerCase();
    if (w === 'logo') return 'logo';
    if (w === 'video' || w === 'clip' || w === 'animation') return 'video';
    return 'image';
  }

  async function surprise() {
    if (loading || surpriseBtn.disabled) return;
    const kind = mode === 'chat' ? 'image' : mode;
    if (mode === 'chat') setMode('image');
    surpriseBtn.disabled = true;
    const original = surpriseBtn.innerHTML;
    surpriseBtn.innerHTML = '<i class="fa-solid fa-circle-notch spin"></i> Thinking';
    try {
      const data = await postApi({ action: 'prompt', kind: kind, seed: input.value.trim() });
      input.value = data.prompt;
      autoGrow();
      input.focus();
    } catch (err) {
      showError('I could not come up with a prompt right now. ' + (err.message || ''), surprise);
    } finally {
      surpriseBtn.disabled = false;
      surpriseBtn.innerHTML = original;
    }
  }
  surpriseBtn.addEventListener('click', surprise);

  /* ---------- Rendering ---------- */
  function showWelcome() {
    thread.innerHTML = '';
    const w = document.createElement('div');
    w.className = 'welcome';
    w.appendChild(makeAvatar('xl'));
    const h1 = document.createElement('h1');
    h1.innerHTML = 'Hi, I\u2019m <span>' + escapeHtml(AI_NAME) + '</span>';
    const p = document.createElement('p');
    p.textContent = 'I help with coding and debugging, and I can create images, logos and short videos from your ideas.';
    const cards = document.createElement('div');
    cards.className = 'cards';
    SUGGESTIONS.forEach((s) => {
      const b = document.createElement('button');
      b.className = 'card';
      b.type = 'button';
      b.innerHTML = '<i class="fa-solid ' + s.icon + '"></i><strong>' + escapeHtml(s.title) + '</strong><span>' + escapeHtml(s.text) + '</span>';
      b.addEventListener('click', () => {
        if (s.action === 'send') { setMode('chat'); sendMessage(s.prompt); }
        else if (s.action === 'mode') setMode(s.mode);
        else surprise();
      });
      cards.appendChild(b);
    });
    w.append(h1, p, cards);
    thread.appendChild(w);
  }

  function buildMedia(m) {
    const box = document.createElement('div');
    box.className = 'media';
    if (!isSafeUrl(m.url)) return box;
    let el;
    if (m.type === 'video') {
      el = document.createElement('video');
      el.controls = true;
      el.playsInline = true;
      el.loop = true;
      el.preload = 'metadata';
      el.src = m.url;
    } else {
      el = document.createElement('img');
      el.alt = m.prompt || 'Generated image';
      el.loading = 'lazy';
      el.src = m.url;
    }
    const foot = document.createElement('div');
    foot.className = 'media-foot';
    const label = document.createElement('span');
    label.textContent = m.type === 'video' ? 'Generated video' : (m.kind === 'logo' ? 'Generated logo' : 'Generated image');
    const link = document.createElement('a');
    link.href = m.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.download = '';
    link.innerHTML = '<i class="fa-solid fa-download"></i> Open / Download';
    foot.append(label, link);
    box.append(el, foot);
    return box;
  }

  function buildMessage(m) {
    const row = document.createElement('div');
    if (m.role === 'user') {
      row.className = 'msg user';
      const b = document.createElement('div');
      b.className = 'bubble';
      b.textContent = m.content;
      row.appendChild(b);
      return row;
    }

    row.className = 'msg ai';
    row.appendChild(makeAvatar('xs'));
    const body = document.createElement('div');
    body.className = 'ai-body';

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    if (m.type === 'image' || m.type === 'video') {
      const cap = document.createElement('p');
      cap.textContent = m.content;
      bubble.appendChild(cap);
      bubble.appendChild(buildMedia(m));
      if (m.prompt) {
        const pu = document.createElement('div');
        pu.className = 'prompt-used';
        const b = document.createElement('b');
        b.textContent = 'Prompt used: ';
        pu.append(b, document.createTextNode(m.prompt));
        bubble.appendChild(pu);
      }
    } else {
      bubble.innerHTML = formatMarkdown(m.content);
    }

    const copyValue = m.type ? (m.prompt || m.content) : m.content;
    const actions = document.createElement('div');
    actions.className = 'actions';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'act';
    copyBtn.type = 'button';
    copyBtn.title = m.type ? 'Copy prompt' : 'Copy';
    copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i>';
    copyBtn.addEventListener('click', async () => {
      const ok = await copyText(copyValue);
      if (!ok) return;
      copyBtn.innerHTML = '<i class="fa-solid fa-check"></i><span class="lbl">Copied</span>';
      setTimeout(() => { copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i>'; }, 1600);
    });

    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = formatTime(m.time || Date.now());

    const up = document.createElement('button');
    up.className = 'act'; up.type = 'button'; up.title = 'Good response';
    const down = document.createElement('button');
    down.className = 'act'; down.type = 'button'; down.title = 'Bad response';

    const paintFeedback = () => {
      up.classList.toggle('active', m.feedback === 'up');
      down.classList.toggle('active', m.feedback === 'down');
      up.innerHTML = '<i class="' + (m.feedback === 'up' ? 'fa-solid' : 'fa-regular') + ' fa-thumbs-up"></i>';
      down.innerHTML = '<i class="' + (m.feedback === 'down' ? 'fa-solid' : 'fa-regular') + ' fa-thumbs-down"></i>';
    };
    const setFeedback = (type) => { m.feedback = m.feedback === type ? null : type; paintFeedback(); saveChats(); };
    up.addEventListener('click', () => setFeedback('up'));
    down.addEventListener('click', () => setFeedback('down'));
    paintFeedback();

    actions.append(copyBtn, time, up, down);
    body.append(bubble, actions);
    row.appendChild(body);
    return row;
  }

  function renderChat() {
    const chat = getChat();
    if (!chat || !chat.messages.length) { showWelcome(); return; }
    thread.innerHTML = '';
    chat.messages.forEach((m) => thread.appendChild(buildMessage(m)));
    scrollBottom();
  }

  function renderList() {
    chatList.innerHTML = '';
    if (!chats.length) {
      const e = document.createElement('div');
      e.className = 'empty-list';
      e.textContent = 'No chats yet.';
      chatList.appendChild(e);
      return;
    }
    [...chats].sort((a, b) => b.updated - a.updated).forEach((c) => {
      const item = document.createElement('div');
      item.className = 'chat-item' + (c.id === currentId ? ' active' : '');
      const open = document.createElement('button');
      open.className = 'open-chat';
      open.type = 'button';
      open.textContent = c.title || 'New chat';
      open.addEventListener('click', () => { openChat(c.id); closeSidebar(); });
      const del = document.createElement('button');
      del.className = 'del';
      del.type = 'button';
      del.title = 'Delete chat';
      del.innerHTML = '<i class="fa-regular fa-trash-can"></i>';
      del.addEventListener('click', (e) => { e.stopPropagation(); deleteChat(c.id); });
      item.append(open, del);
      chatList.appendChild(item);
    });
  }

  /* ---------- Chat actions ---------- */
  function openChat(id) { if (loading) return; currentId = id; renderList(); renderChat(); }
  function newChat() { if (loading) return; currentId = null; renderList(); renderChat(); input.focus(); }
  function deleteChat(id) {
    if (loading && id === currentId) return;
    if (!confirm('Delete this chat?')) return;
    chats = chats.filter((c) => c.id !== id);
    saveChats();
    if (id === currentId) currentId = null;
    renderList();
    renderChat();
  }

  function showProgress(label) {
    const row = document.createElement('div');
    row.className = 'msg ai typing';
    row.id = 'typingRow';
    row.appendChild(makeAvatar('xs'));
    const body = document.createElement('div');
    body.className = 'ai-body';
    const card = document.createElement('div');
    card.className = 'render-card';
    card.innerHTML = '<div class="dots"><i></i><i></i><i></i></div>';
    const text = document.createElement('span');
    text.textContent = label || '';
    card.appendChild(text);
    body.appendChild(card);
    row.appendChild(body);
    thread.appendChild(row);
    scrollBottom();
    return { setText: (t) => { text.textContent = t; } };
  }
  function hideTyping() { const t = $('typingRow'); if (t) t.remove(); }

  function showError(message, retryFn) {
    const row = document.createElement('div');
    row.className = 'msg ai';
    row.appendChild(makeAvatar('xs'));
    const body = document.createElement('div');
    body.className = 'ai-body';
    const box = document.createElement('div');
    box.className = 'error-bubble';
    const msg = document.createElement('div');
    msg.textContent = message;
    box.appendChild(msg);
    if (retryFn) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = 'Try again';
      retry.addEventListener('click', () => { row.remove(); retryFn(); });
      box.appendChild(retry);
    }
    body.appendChild(box);
    row.appendChild(body);
    thread.appendChild(row);
    scrollBottom();
  }

  function updateSendState() { sendBtn.disabled = loading || !input.value.trim(); }

  function pushAssistant(chat, msg) {
    chat.messages.push(msg);
    chat.updated = Date.now();
    saveChats();
    if (chat.id === currentId) thread.appendChild(buildMessage(msg));
    renderList();
    scrollBottom();
  }

  /* ---------- Text chat ---------- */
  async function requestReply() {
    const chat = getChat();
    if (!chat) return;
    const chatId = chat.id;
    loading = true;
    updateSendState();
    showProgress('');

    const payload = chat.messages
      .filter((m) => !m.type && (m.role === 'user' || m.role === 'assistant') && m.content)
      .slice(-MAX_HISTORY)
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      const data = await postApi({ action: 'chat', messages: payload });
      if (!data.reply) throw new Error('Empty reply.');
      hideTyping();
      pushAssistant(chat, { role: 'assistant', content: data.reply, time: Date.now(), feedback: null });
    } catch (err) {
      hideTyping();
      if (chatId === currentId) {
        showError(!navigator.onLine
          ? 'You appear to be offline. Check your connection and try again.'
          : 'I could not get a reply right now. ' + (err && err.message ? err.message : ''), requestReply);
      }
    } finally {
      loading = false;
      updateSendState();
    }
  }

  /* ---------- Media generation ---------- */
  function preloadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const timer = setTimeout(() => reject(new Error('The image took too long to render.')), 90000);
      img.onload = () => { clearTimeout(timer); resolve(); };
      img.onerror = () => { clearTimeout(timer); reject(new Error('The image could not be rendered. Try rewording the prompt.')); };
      img.src = url;
    });
  }

  async function pollVideo(id, onTick) {
    const started = Date.now();
    while (Date.now() - started < VIDEO_TIMEOUT_MS) {
      await sleep(VIDEO_POLL_MS);
      const r = await postApi({ action: 'video-status', id: id });
      onTick(Math.round((Date.now() - started) / 1000));
      if (r.status === 'succeeded' && r.url) return r.url;
      if (r.status === 'failed' || r.status === 'canceled') throw new Error(r.error || 'Video generation failed.');
    }
    throw new Error('The video took too long to render. Please try again.');
  }

  async function runMedia(kind, prompt) {
    const chat = getChat();
    if (!chat) return;
    const chatId = chat.id;
    loading = true;
    updateSendState();
    const isVideo = kind === 'video';
    const progress = showProgress(isVideo ? 'Writing the shot list' : (kind === 'logo' ? 'Designing your logo' : 'Painting your image'));

    try {
      if (isVideo) {
        const start = await postApi({ action: 'video', prompt: prompt });
        progress.setText('Rendering video, 0s');
        const url = await pollVideo(start.id, (s) => progress.setText('Rendering video, ' + s + 's'));
        hideTyping();
        pushAssistant(chat, {
          role: 'assistant', type: 'video', kind: 'video', content: 'Your video is ready.',
          url: url, prompt: start.prompt, time: Date.now(), feedback: null
        });
      } else {
        const data = await postApi({ action: 'image', kind: kind, prompt: prompt });
        progress.setText('Rendering');
        await preloadImage(data.url);
        hideTyping();
        pushAssistant(chat, {
          role: 'assistant', type: 'image', kind: kind,
          content: kind === 'logo' ? 'Your logo is ready.' : 'Your image is ready.',
          url: data.url, prompt: data.prompt, time: Date.now(), feedback: null
        });
      }
    } catch (err) {
      hideTyping();
      if (chatId === currentId) {
        showError(!navigator.onLine
          ? 'You appear to be offline. Check your connection and try again.'
          : (err && err.message ? err.message : 'Generation failed.'), () => runMedia(kind, prompt));
      }
    } finally {
      loading = false;
      updateSendState();
    }
  }

  /* ---------- Sending ---------- */
  function ensureChat(titleSource) {
    let chat = getChat();
    if (!chat) {
      chat = { id: uid(), title: titleSource.slice(0, 40), messages: [], updated: Date.now() };
      chats.push(chat);
      currentId = chat.id;
    }
    if (thread.querySelector('.welcome')) thread.innerHTML = '';
    return chat;
  }

  function sendMessage(text, forcedKind) {
    const content = String(text || '').trim();
    if (!content || loading) return;

    const kind = forcedKind || (mode !== 'chat' ? mode : detectKind(content));
    const chat = ensureChat(content);

    const userMsg = { role: 'user', content: content, time: Date.now() };
    chat.messages.push(userMsg);
    chat.updated = Date.now();
    saveChats();
    thread.appendChild(buildMessage(userMsg));
    renderList();
    scrollBottom();

    input.value = '';
    autoGrow();
    closeSidebar();

    if (kind) runMedia(kind, content);
    else requestReply();
  }

  /* ---------- Input ---------- */
  function autoGrow() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 160) + 'px';
    updateSendState();
  }
  input.addEventListener('input', autoGrow);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) {
      e.preventDefault();
      sendMessage(input.value);
    }
  });
  sendBtn.addEventListener('click', () => sendMessage(input.value));

  /* ---------- Code buttons (delegated) ---------- */
  thread.addEventListener('click', async (e) => {
    const usePrompt = e.target.closest('.use-prompt');
    if (usePrompt) {
      const text = usePrompt.closest('.code-block').querySelector('pre code').textContent;
      sendMessage(text, usePrompt.dataset.kind);
      return;
    }
    const btn = e.target.closest('.copy-code');
    if (!btn) return;
    const code = btn.closest('.code-block').querySelector('pre code').textContent;
    const ok = await copyText(code);
    if (!ok) return;
    const label = btn.querySelector('span');
    label.textContent = 'Copied';
    setTimeout(() => { label.textContent = 'Copy code'; }, 1600);
  });

  /* ---------- Sidebar ---------- */
  function openSidebar() { sidebar.classList.add('open'); overlay.classList.add('show'); }
  function closeSidebar() { sidebar.classList.remove('open'); overlay.classList.remove('show'); }
  $('menuBtn').addEventListener('click', openSidebar);
  overlay.addEventListener('click', closeSidebar);
  $('newChatBtn').addEventListener('click', () => { newChat(); closeSidebar(); });

  /* ---------- Init ---------- */
  $('brandAvatar').appendChild(makeAvatar('sm'));
  $('topAvatar').appendChild(makeAvatar('md'));
  $('brandName').textContent = AI_NAME;
  $('topName').textContent = AI_NAME;

  loadChats();
  renderList();
  renderChat();
  updateSendState();
})();
