"use client";

import { useState, useEffect, useRef } from "react";

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  model: string;
  createdAt: number;
  isTemporary?: boolean;
}

interface WorkspaceFile {
  name: string;
  path: string;
}

interface AttachedLocalFile {
  name: string;
  content: string;
  size: number;
  type: string;
}

const MODEL_DETAILS = [
  { id: "claude-opus-4-6", name: "claude-opus-4-6", desc: "Reseller Claude 4.6 - Default premium intelligence", method: "Method 1: Custom Base URL" },
  { id: "claude-opus-4-8", name: "claude-opus-4-8", desc: "Reseller Claude 4.8 - Advanced reasoning capability", method: "Method 1: Custom Base URL" },
  { id: "claude-opus-4-7", name: "claude-opus-4-7", desc: "Reseller Claude 4.7 - Balanced high speed intelligence", method: "Method 1: Custom Base URL" },
  { id: "gpt-5.5", name: "gpt-5.5", desc: "GPT-5.5 (OpenAI Compatible) - Ultra reasoning model", method: "Method 2: /v1 Route" },
  { id: "glm-5.2", name: "glm-5.2", desc: "GLM-5.2 (OpenAI Compatible) - Dual language reasoning model", method: "Method 2: /v1 Route" }
];

export default function Home() {
  // Theme state
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  // Chat sessions state
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<string>("");

  // Input states
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Settings states
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://agentrouter.org");
  const [selectedModel, setSelectedModel] = useState("claude-opus-4-6");
  const [customModel, setCustomModel] = useState("");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);

  // Connection tester states
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [connectionError, setConnectionError] = useState("");

  // Workspace integration states
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([]);
  const [attachedFiles, setAttachedFiles] = useState<WorkspaceFile[]>([]);
  const [attachedLocalFiles, setAttachedLocalFiles] = useState<AttachedLocalFile[]>([]);
  const [isFilesModalOpen, setIsFilesModalOpen] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  // Sidebar visibility — start collapsed, open only on desktop after mount
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);

  // Temporary chat state
  const [isTemporaryActive, setIsTemporaryActive] = useState(false);

  // Refs for scrolling, abortion, and file input
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load initial settings and chats from localStorage on mount
  useEffect(() => {
    // Theme
    const savedTheme = localStorage.getItem("ar-theme");
    if (savedTheme === "light" || savedTheme === "dark") {
      setTheme(savedTheme);
      document.documentElement.setAttribute("data-theme", savedTheme);
    } else {
      document.documentElement.setAttribute("data-theme", "dark");
    }

    // API settings
    const savedApiKey = localStorage.getItem("ar-api-key");
    const savedBaseUrl = localStorage.getItem("ar-base-url");
    const savedModel = localStorage.getItem("ar-model");
    
    if (savedApiKey) setApiKey(savedApiKey);
    if (savedBaseUrl) setBaseUrl(savedBaseUrl);
    if (savedModel) setSelectedModel(savedModel);

    // Chats history — always boot with an empty "new chat" on top
    const savedChats = localStorage.getItem("ar-chats");
    const emptyBootChat: ChatSession = {
      id: Date.now().toString(),
      title: "New Conversation",
      messages: [],
      model: localStorage.getItem("ar-model") || "claude-opus-4-6",
      createdAt: Date.now(),
      isTemporary: false
    };

    if (savedChats) {
      try {
        const parsed = JSON.parse(savedChats) as ChatSession[];
        // Prepend empty boot chat
        const allChats = [emptyBootChat, ...parsed];
        setChats(allChats);
        setActiveChatId(emptyBootChat.id);
      } catch (e) {
        console.error("Failed to parse chats history", e);
        setChats([emptyBootChat]);
        setActiveChatId(emptyBootChat.id);
      }
    } else {
      setChats([emptyBootChat]);
      setActiveChatId(emptyBootChat.id);
    }

    // Load workspace files list
    fetchWorkspaceFiles();

    // Open sidebar on desktop, keep collapsed on mobile
    if (window.innerWidth > 768) {
      setSidebarCollapsed(false);
    }
  }, []);

  // Save chats to localStorage whenever they change (filtering empty and temporary chats)
  useEffect(() => {
    const persistentChats = chats.filter(c => !c.isTemporary && c.messages.length > 0);
    if (persistentChats.length > 0) {
      localStorage.setItem("ar-chats", JSON.stringify(persistentChats));
    } else {
      localStorage.removeItem("ar-chats");
    }
  }, [chats]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsModelMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Scroll to bottom on messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chats, activeChatId, isLoading]);

  // Adjust theme
  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    localStorage.setItem("ar-theme", nextTheme);
    document.documentElement.setAttribute("data-theme", nextTheme);
  };

  // Fetch file list in workspace
  const fetchWorkspaceFiles = async () => {
    setLoadingFiles(true);
    try {
      const res = await fetch("/api/workspace");
      if (res.ok) {
        const data = await res.json();
        setWorkspaceFiles(data.files || []);
      }
    } catch (err) {
      console.error("Error fetching workspace files:", err);
    } finally {
      setLoadingFiles(false);
    }
  };

  // Get current active chat
  const activeChat = chats.find(c => c.id === activeChatId);

  // Group chats by date (Today, Yesterday, Previous 7 Days, Older)
  const groupChatsByDate = () => {
    const groups: { [key: string]: ChatSession[] } = {
      Today: [],
      Yesterday: [],
      "Previous 7 Days": [],
      Older: []
    };

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
    const startOfSevenDaysAgo = startOfToday - 7 * 24 * 60 * 60 * 1000;

    chats.forEach(chat => {
      // Hide temporary chats unless they are currently active
      if (chat.isTemporary && chat.id !== activeChatId) return;

      if (chat.createdAt >= startOfToday) {
        groups.Today.push(chat);
      } else if (chat.createdAt >= startOfYesterday) {
        groups.Yesterday.push(chat);
      } else if (chat.createdAt >= startOfSevenDaysAgo) {
        groups["Previous 7 Days"].push(chat);
      } else {
        groups.Older.push(chat);
      }
    });

    return Object.keys(groups)
      .filter(key => groups[key].length > 0)
      .map(key => ({
        title: key,
        items: groups[key]
      }));
  };

  // Create a new conversation (re-using active empty chat and deleting unused ones)
  const createNewChat = (title = "New Conversation", systemPrompt?: string) => {
    // If the active chat is already empty, re-use it
    if (activeChat && activeChat.messages.length === 0) {
      setChats(prev => prev.map(c => c.id === activeChatId ? {
        ...c,
        isTemporary: isTemporaryActive,
        model: customModel || selectedModel
      } : c));
      return activeChatId;
    }

    const id = Date.now().toString();
    const newSession: ChatSession = {
      id,
      title,
      messages: systemPrompt ? [{ role: "system", content: systemPrompt }] : [],
      model: customModel || selectedModel,
      createdAt: Date.now(),
      isTemporary: isTemporaryActive
    };

    // Clean up any other empty chats
    setChats(prev => [newSession, ...prev.filter(c => c.messages.length > 0)]);
    setActiveChatId(id);
    return id;
  };

  // Toggle Temporary Chat Mode
  const toggleTemporaryChat = () => {
    const nextTempState = !isTemporaryActive;
    setIsTemporaryActive(nextTempState);

    const id = Date.now().toString();
    const newSession: ChatSession = {
      id,
      title: "New Conversation",
      messages: [],
      model: customModel || selectedModel,
      createdAt: Date.now(),
      isTemporary: nextTempState
    };

    // Switch immediately and cleanup other empty chats
    setChats(prev => [newSession, ...prev.filter(c => c.messages.length > 0)]);
    setActiveChatId(id);
  };

  // Switch chats and discard any empty history
  const handleSelectChat = (id: string) => {
    setChats(prev => prev.filter(c => c.messages.length > 0 || c.id === id));
    setActiveChatId(id);
  };

  // Delete session
  const deleteChat = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const remaining = chats.filter(c => c.id !== id);
    setChats(remaining);
    if (activeChatId === id) {
      if (remaining.length > 0) {
        setActiveChatId(remaining[0].id);
      } else {
        setActiveChatId("");
      }
    }
  };

  // Save specific API configs
  const saveSettings = () => {
    localStorage.setItem("ar-api-key", apiKey);
    localStorage.setItem("ar-base-url", baseUrl);
    localStorage.setItem("ar-model", selectedModel);
    setIsSettingsOpen(false);
    
    // Update active chat model if one exists and has no messages
    if (activeChat && activeChat.messages.length === 0) {
      setChats(prev => prev.map(c => c.id === activeChatId ? { ...c, model: customModel || selectedModel } : c));
    }
  };

  // Handle preset model change and auto-adjust base URL based on methods
  const handleModelChange = (model: string) => {
    setSelectedModel(model);
    if (model === "gpt-5.5" || model === "glm-5.2") {
      setBaseUrl("https://agentrouter.org/v1");
    } else if (model.startsWith("claude-")) {
      setBaseUrl("https://agentrouter.org");
    }
    
    // Update active chat model if one exists and has no messages
    if (activeChat && activeChat.messages.length === 0) {
      setChats(prev => prev.map(c => c.id === activeChatId ? { ...c, model } : c));
    }
  };

  // Test API connectivity by sending "OK only" to AgentRouter
  const testConnectivity = async () => {
    setConnectionStatus("testing");
    setConnectionError("");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          baseUrl,
          model: customModel || selectedModel,
          messages: [{ role: "user", content: "OK only" }],
          stream: false
        })
      });

      const data = await res.json();
      if (res.ok) {
        setConnectionStatus("success");
      } else {
        setConnectionStatus("error");
        setConnectionError(data.error || "Unknown connectivity error.");
      }
    } catch (err: any) {
      setConnectionStatus("error");
      setConnectionError(err.message || "Failed to make test request.");
    }
  };

  // Attach a workspace file (toggle)
  const handleAttachFile = (file: WorkspaceFile) => {
    if (attachedFiles.find(f => f.path === file.path)) {
      setAttachedFiles(prev => prev.filter(f => f.path !== file.path));
    } else {
      setAttachedFiles(prev => [...prev, file]);
    }
  };

  // Handle local file upload via browser file picker
  const handleLocalFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach(file => {
      // Skip if already attached
      if (attachedLocalFiles.find(f => f.name === file.name && f.size === file.size)) return;

      const reader = new FileReader();
      reader.onload = (ev) => {
        const content = ev.target?.result as string;
        setAttachedLocalFiles(prev => [...prev, {
          name: file.name,
          content,
          size: file.size,
          type: file.type
        }]);
      };
      // Read text files as text, others as data URL
      if (file.type.startsWith("text/") || /\.(ts|tsx|js|jsx|json|md|txt|css|html|xml|yaml|yml|csv|py|rb|go|rs|java|c|cpp|h|sh|env)$/.test(file.name)) {
        reader.readAsText(file);
      } else {
        reader.readAsDataURL(file);
      }
    });

    // Reset so same file can be re-selected
    e.target.value = "";
  };

  const removeLocalFile = (name: string, size: number) => {
    setAttachedLocalFiles(prev => prev.filter(f => !(f.name === name && f.size === size)));
  };

  // Handle submitting prompt
  const handleSubmitPrompt = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!input.trim() && attachedFiles.length === 0 && attachedLocalFiles.length === 0) return;
    
    // Open settings if no API key is specified
    if (!apiKey.trim()) {
      setIsSettingsOpen(true);
      setConnectionStatus("error");
      setConnectionError("Please enter your AgentRouter API Key to start chatting.");
      return;
    }

    if (isLoading) return;

    let chatId = activeChatId;
    if (!chatId) {
      chatId = createNewChat(input.slice(0, 30) || "Workspace Query");
    }

    const currentChat = chats.find(c => c.id === chatId) || {
      id: chatId,
      title: input.slice(0, 30) || "Workspace Query",
      messages: [],
      model: customModel || selectedModel,
      createdAt: Date.now()
    };

    setIsLoading(true);
    
    // Build file context from local browser-uploaded files
    let fileContexts = "";
    if (attachedLocalFiles.length > 0) {
      for (const file of attachedLocalFiles) {
        if (file.content.startsWith("data:")) {
          fileContexts += `\n\n--- FILE: ${file.name} (binary, ${file.type}) ---\n[Binary file attached - ${(file.size / 1024).toFixed(1)} KB]\n--- END OF FILE ---`;
        } else {
          fileContexts += `\n\n--- FILE: ${file.name} ---\n${file.content}\n--- END OF FILE ---`;
        }
      }
    }

    // Also load any workspace files
    if (attachedFiles.length > 0) {
      for (const file of attachedFiles) {
        try {
          const res = await fetch("/api/workspace", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filePath: file.path })
          });
          if (res.ok) {
            const data = await res.json();
            fileContexts += `\n\n--- WORKSPACE FILE: ${data.path} ---\n${data.content}\n--- END OF FILE ---`;
          }
        } catch (err) {
          console.error(`Failed to read file ${file.path}:`, err);
        }
      }
    }

    const userPromptContent = fileContexts 
      ? `Below is the content from the attached files for context:\n${fileContexts}\n\nUser Question:\n${input}`
      : input;

    const userMessage: Message = { role: "user", content: userPromptContent };
    
    const allAttachedNames = [
      ...attachedLocalFiles.map(f => f.name),
      ...attachedFiles.map(f => f.name)
    ];

    // UI displays the user input directly
    const displayMessage: Message = { 
      role: "user", 
      content: allAttachedNames.length > 0
        ? `${input} (attached: ${allAttachedNames.join(", ")})`
        : input 
    };

    // Filter out empty assistant messages from history to prevent Anthropic API rejection
    const cleanHistory = currentChat.messages.filter(m => !(m.role === "assistant" && !m.content.trim()));
    const updatedMessages = [...cleanHistory, userMessage];
    
    // Update local chats list state with display message
    setChats(prev => prev.map(c => {
      if (c.id === chatId) {
        const title = c.messages.length === 0 ? (input.slice(0, 35) || "Query") : c.title;
        return {
          ...c,
          title,
          messages: [...c.messages, displayMessage, { role: "assistant", content: "" }]
        };
      }
      return c;
    }));

    setInput("");
    setAttachedFiles([]); 
    setAttachedLocalFiles([]);

    // Setup streaming reader
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          baseUrl,
          model: customModel || selectedModel,
          messages: updatedMessages,
          stream: true
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        let errMsg = "Failed to fetch completions stream.";
        try {
          const errData = await response.json();
          errMsg = errData.error || errMsg;
        } catch (_) {
          try {
            errMsg = await response.text();
          } catch (__) {}
        }
        throw new Error(errMsg);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("Stream response body is not readable.");

      let assistantResponse = "";
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed === "data: [DONE]") continue;

          if (trimmed.startsWith("data:")) {
            try {
              const rawData = trimmed.startsWith("data: ") ? trimmed.slice(6) : trimmed.slice(5);
              const data = JSON.parse(rawData);
              let token = data.choices?.[0]?.delta?.content || "";
              
              // Handle Anthropic / Claude stream format
              if (data.type === "content_block_delta" && data.delta?.text) {
                token = data.delta.text;
              }
              
              assistantResponse += token;

              // Stream response into UI
              setChats(prev => prev.map(c => {
                if (c.id === chatId) {
                  const msgs = [...c.messages];
                  const lastMsg = { ...msgs[msgs.length - 1] };
                  lastMsg.content = assistantResponse;
                  msgs[msgs.length - 1] = lastMsg;
                  return { ...c, messages: msgs };
                }
                return c;
              }));
            } catch (e) {
              // Ignore partial JSON parse errors
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name === "AbortError") {
        console.log("Stream generation aborted.");
      } else {
        const errorMsg = `\n\n[Error: ${err.message || err}]`;
        setChats(prev => prev.map(c => {
          if (c.id === chatId) {
            const msgs = [...c.messages];
            const lastMsg = { ...msgs[msgs.length - 1] };
            lastMsg.content = lastMsg.content ? lastMsg.content + errorMsg : errorMsg;
            msgs[msgs.length - 1] = lastMsg;
            return { ...c, messages: msgs };
          }
          return c;
        }));
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  // Stop response generation
  const stopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsLoading(false);
    }
  };

  // Copy code helper
  const handleCopyCode = (code: string, e: React.MouseEvent) => {
    navigator.clipboard.writeText(code);
    const target = e.currentTarget as HTMLButtonElement;
    const oldText = target.innerHTML;
    target.innerHTML = "Copied!";
    setTimeout(() => {
      target.innerHTML = oldText;
    }, 1500);
  };

  // Custom Markdown parser component
  const renderMessageContent = (content: string) => {
    if (!content) return null;
    const parts = content.split("```");
    
    return parts.map((part, index) => {
      const isCodeBlock = index % 2 === 1;
      
      if (isCodeBlock) {
        const lines = part.split("\n");
        const lang = lines[0].trim() || "code";
        const code = lines.slice(1).join("\n").trim();
        
        return (
          <pre key={index} style={{ position: "relative" }}>
            <div className="code-header">
              <span>{lang.toUpperCase()}</span>
              <button className="code-copy-btn" onClick={(e) => handleCopyCode(code, e)}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                Copy
              </button>
            </div>
            <code>{code}</code>
          </pre>
        );
      } else {
        const lines = part.split("\n");
        return lines.map((line, lIdx) => {
          if (line.startsWith("# ")) {
            return <h1 key={`${index}-${lIdx}`} style={{ margin: "1rem 0 0.5rem 0", fontSize: "1.5rem", fontWeight: "700" }}>{line.slice(2)}</h1>;
          }
          if (line.startsWith("## ")) {
            return <h2 key={`${index}-${lIdx}`} style={{ margin: "0.8rem 0 0.4rem 0", fontSize: "1.25rem", fontWeight: "600" }}>{line.slice(3)}</h2>;
          }
          if (line.startsWith("### ")) {
            return <h3 key={`${index}-${lIdx}`} style={{ margin: "0.7rem 0 0.3rem 0", fontSize: "1.1rem", fontWeight: "600" }}>{line.slice(4)}</h3>;
          }

          if (line.trim().startsWith("- ") || line.trim().startsWith("* ")) {
            const listText = line.trim().slice(2);
            return (
              <li key={`${index}-${lIdx}`} style={{ marginLeft: "1.25rem", marginBottom: "0.2rem" }}>
                {parseInlineFormatting(listText)}
              </li>
            );
          }

          if (!line.trim()) {
            return <div key={`${index}-${lIdx}`} style={{ height: "0.5rem" }} />;
          }

          return (
            <p key={`${index}-${lIdx}`} style={{ marginBottom: "0.4rem" }}>
              {parseInlineFormatting(line)}
            </p>
          );
        });
      }
    });
  };

  // Helper to parse inline bold and single backtick code blocks
  const parseInlineFormatting = (text: string) => {
    const boldRegex = /\*\*(.*?)\*\*/g;
    const inlineCodeRegex = /`(.*?)`/g;

    const elements: React.ReactNode[] = [];
    const tokens: { type: "text" | "bold" | "code"; value: string; index: number }[] = [];
    
    let match;
    while ((match = boldRegex.exec(text)) !== null) {
      tokens.push({ type: "bold", value: match[1], index: match.index });
    }
    
    inlineCodeRegex.lastIndex = 0;
    while ((match = inlineCodeRegex.exec(text)) !== null) {
      tokens.push({ type: "code", value: match[1], index: match.index });
    }

    tokens.sort((a, b) => a.index - b.index);

    let cursor = 0;
    for (const token of tokens) {
      if (token.index < cursor) continue;
      
      if (token.index > cursor) {
        elements.push(text.slice(cursor, token.index));
      }
      
      if (token.type === "bold") {
        elements.push(<strong key={token.index}>{token.value}</strong>);
        cursor = token.index + token.value.length + 4;
      } else {
        elements.push(<code key={token.index}>{token.value}</code>);
        cursor = token.index + token.value.length + 2;
      }
    }
    
    if (cursor < text.length) {
      elements.push(text.slice(cursor));
    }

    return elements.length > 0 ? elements : text;
  };

  const filteredFiles = workspaceFiles.filter(f => 
    f.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    f.path.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const activeModelDetails = MODEL_DETAILS.find(m => m.id === selectedModel) || {
    id: selectedModel,
    name: customModel || selectedModel,
    desc: "Custom Model override config active",
    method: "User Custom Method"
  };

  return (
    <div className="app-container">
      {/* Mobile backdrop — tap outside to close sidebar */}
      {!sidebarCollapsed && (
        <div
          onClick={() => setSidebarCollapsed(true)}
          style={{
            display: "none",
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            zIndex: 199,
          }}
          className="mobile-sidebar-backdrop"
        />
      )}
      {/* ChatGPT Sidebar Drawer */}
      <aside className={`sidebar ${sidebarCollapsed ? "collapsed" : ""}`}>
        <div className="sidebar-header">
          <div className="sidebar-title">ModelDeck</div>
          <button className="btn-icon" onClick={() => setSidebarCollapsed(true)} title="Collapse sidebar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>
          </button>
        </div>

        <button 
          className="btn-new-chat" 
          onClick={() => createNewChat()}
          id="new-chat-btn"
        >
          <span>New chat</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        </button>

        {/* Chat History Grouped List */}
        <div className="chat-list">
          {chats.length === 0 ? (
            <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "0.8rem", marginTop: "1rem" }}>
              No conversations
            </div>
          ) : (
            groupChatsByDate().map(group => (
              <div key={group.title}>
                <div className="chat-group-title">{group.title}</div>
                <div className="chat-group-items">
                  {group.items.map(session => (
                    <div 
                      key={session.id} 
                      className={`chat-item ${activeChatId === session.id ? "active" : ""}`}
                      onClick={() => handleSelectChat(session.id)}
                    >
                      <div className="chat-item-title">{session.title}</div>
                      <div className="chat-item-actions">
                        <button 
                          className="chat-item-btn" 
                          onClick={(e) => deleteChat(session.id, e)} 
                          title="Delete"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Sidebar Footer Profiles */}
        <div className="sidebar-footer">
          <div className="sidebar-profile" onClick={toggleTheme}>
            {theme === "dark" ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
            )}
            <span>{theme === "dark" ? "Light Theme" : "Dark Theme"}</span>
          </div>
          <div className="sidebar-profile" onClick={() => setIsSettingsOpen(true)} id="settings-btn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
            <span>API Settings</span>
          </div>
        </div>
      </aside>

      {/* Main Screen Content */}
      <main className="main-content">
        {/* Header Toolbar */}
        <header className="header">
          <div className="header-left">
            {sidebarCollapsed && (
              <button className="btn-icon" onClick={() => setSidebarCollapsed(false)} title="Expand sidebar">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>
              </button>
            )}
            
            {/* Top Model selection Dropdown Menu */}
            <div className="model-dropdown-container" ref={dropdownRef}>
              <button 
                className="model-dropdown-trigger" 
                onClick={() => setIsModelMenuOpen(!isModelMenuOpen)}
                id="model-selector-btn"
              >
                <span>{customModel || activeModelDetails.name}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </button>
              
              {isModelMenuOpen && (
                <div className="model-dropdown-menu">
                  {MODEL_DETAILS.map(m => (
                    <div 
                      key={m.id} 
                      className={`model-dropdown-item ${selectedModel === m.id && !customModel ? "active" : ""}`}
                      onClick={() => {
                        handleModelChange(m.id);
                        setCustomModel("");
                        setIsModelMenuOpen(false);
                      }}
                    >
                      <div style={{ flexGrow: 1 }}>
                        <div className="model-item-title">
                          <span>{m.name}</span>
                          {selectedModel === m.id && !customModel && (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent-color)" strokeWidth="3.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
                          )}
                        </div>
                        <div className="model-item-desc">{m.desc}</div>
                      </div>
                    </div>
                  ))}
                  <div style={{ padding: "8px 12px", borderTop: "1px solid var(--border-color)", marginTop: "4px" }}>
                    <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "4px" }}>Custom Model ID</div>
                    <input 
                      type="text" 
                      className="form-input" 
                      style={{ width: "100%", padding: "6px 8px", fontSize: "0.8rem" }}
                      placeholder="e.g. gpt-4o" 
                      value={customModel} 
                      onChange={(e) => setCustomModel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          setIsModelMenuOpen(false);
                        }
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
          
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            {/* Temporary Chat toggle — ChatGPT style */}
            <button
              className="temp-chat-header-btn"
              onClick={toggleTemporaryChat}
              title={isTemporaryActive ? "Temporary chat is ON — click to turn off" : "Turn on temporary chat"}
              id="temp-chat-header-btn"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "5px 10px",
                borderRadius: "8px",
                background: isTemporaryActive ? "rgba(16, 163, 127, 0.1)" : "transparent",
                border: isTemporaryActive ? "1px solid rgba(16, 163, 127, 0.3)" : "1px solid transparent",
                color: isTemporaryActive ? "var(--accent-color)" : "var(--text-secondary)",
                cursor: "pointer",
                fontSize: "0.8rem",
                fontWeight: 500,
                transition: "all 0.2s ease",
                whiteSpace: "nowrap"
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg>
              <span>{isTemporaryActive ? "Temporary" : "Temporary"}</span>
            </button>
            {/* Settings gear removed from header as requested (available in sidebar footer) */}
          </div>
        </header>

        <div style={{ flexGrow: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
          {/* ChatGPT-style temporary chat banner — inside the chat area, above messages */}
          {activeChat?.isTemporary && (
            <div style={{
              background: "transparent",
              borderBottom: "1px solid var(--border-color)",
              padding: "10px 24px",
              fontSize: "0.82rem",
              color: "var(--text-secondary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              flexShrink: 0,
              textAlign: "center"
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
              <span>This conversation won't appear in your history. <button onClick={toggleTemporaryChat} style={{ background: "none", border: "none", color: "var(--accent-color)", cursor: "pointer", fontWeight: 600, padding: 0, fontSize: "inherit" }}>Turn off Temporary Chat</button></span>
            </div>
          )}
          {!activeChat || activeChat.messages.length === 0 ? (
            /* ChatGPT Style empty state greeting */
            <div className="chatgpt-empty-state">
              <div className="chatgpt-logo-container">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>
              </div>
              <h1 className="chatgpt-greeting">What can I help with today?</h1>
              
              <div className="chatgpt-suggestions-grid">
                <div 
                  className="suggestion-card"
                  onClick={() => {
                    if (!activeChatId) createNewChat();
                    setInput("After saving, first send \"OK only\" to test connectivity, then test reading the current working area file.");
                  }}
                >
                  <div className="suggestion-title">Run WAF Connectivity Test</div>
                  <div className="suggestion-desc">Pre-fill the custom instruction checking connection and working directory files.</div>
                </div>
                <div className="suggestion-card" onClick={() => setIsFilesModalOpen(true)}>
                  <div className="suggestion-title">Load local files</div>
                  <div className="suggestion-desc">Inject package.json, TS configurations, or files as prompt context.</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="messages-container">
              {activeChat.messages.map((message, index) => {
                if (message.role === "system") return null;
                const isUser = message.role === "user";
                return (
                  <div key={index} className="message-width-limiter">
                    <div className={`message-row ${isUser ? "user" : "assistant"}`}>
                      {!isUser && (
                        <div className="avatar-circle">AR</div>
                      )}
                      <div className="message-bubble">
                        {renderMessageContent(message.content)}
                        {isLoading && index === activeChat.messages.length - 1 && !isUser && (
                          <span className="streaming-pulse" />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input Drawer Pill */}
        <div className="input-panel">
          <div className="input-width-limiter">
            {/* Hidden native file input */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="*/*"
              style={{ display: "none" }}
              onChange={handleLocalFileChange}
              id="native-file-input"
            />
            <form onSubmit={handleSubmitPrompt} className="input-pill-container">
              {(attachedLocalFiles.length > 0 || attachedFiles.length > 0) && (
                <div className="attachment-container">
                  {attachedLocalFiles.map(file => (
                    <div key={`${file.name}-${file.size}`} className="attachment-pill">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                      <span>{file.name}</span>
                      <button type="button" className="attachment-close" onClick={() => removeLocalFile(file.name, file.size)}>&times;</button>
                    </div>
                  ))}
                  {attachedFiles.map(file => (
                    <div key={file.path} className="attachment-pill">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                      <span>{file.name}</span>
                      <button type="button" className="attachment-close" onClick={() => handleAttachFile(file)}>&times;</button>
                    </div>
                  ))}
                </div>
              )}
              
              <div className="input-row">
                <button 
                  type="button" 
                  className="btn-icon" 
                  onClick={() => fileInputRef.current?.click()}
                  title="Attach file from your computer"
                  id="attach-file-btn"
                  style={{ marginRight: "4px" }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                </button>
                
                <textarea
                  className="chat-textarea"
                  placeholder="Message ModelDeck..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSubmitPrompt();
                    }
                  }}
                  rows={1}
                />

                {isLoading ? (
                  <button 
                    type="button" 
                    className="btn-send" 
                    onClick={stopGeneration} 
                    title="Stop generation"
                    style={{ backgroundColor: "#ef4444", color: "#fff" }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>
                  </button>
                ) : (
                  <button 
                    type="submit" 
                    className="btn-send" 
                    disabled={!input.trim() && attachedFiles.length === 0}
                    title="Send message"
                    id="send-msg-btn"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>
                  </button>
                )}
              </div>
            </form>
            <div className="footer-disclaimer">
              ModelDeck can make mistakes. Verify important info.
            </div>
          </div>
        </div>
      </main>

      {/* Settings Modal (Quick configs) */}
      {isSettingsOpen && (
        <div className="modal-overlay" onClick={() => setIsSettingsOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ fontWeight: 600 }}>API Settings</h3>
              <button className="btn-icon" onClick={() => setIsSettingsOpen(false)} title="Close">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
            <div className="modal-body">
              {connectionStatus !== "idle" && (
                <div className={`tester-banner ${connectionStatus === "success" ? "success" : connectionStatus === "error" ? "error" : ""}`}>
                  <span>
                    {connectionStatus === "testing" && "Checking API credentials..."}
                    {connectionStatus === "success" && "Connected Successfully!"}
                    {connectionStatus === "error" && `Error: ${connectionError}`}
                  </span>
                  {connectionStatus !== "testing" && (
                    <button className="btn-icon" onClick={() => setConnectionStatus("idle")} style={{ width: "20px", height: "20px", color: "inherit" }}>&times;</button>
                  )}
                </div>
              )}

              <div className="form-group">
                <label>Preset Model</label>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "4px" }}>
                  {MODEL_DETAILS.map(m => {
                    const isSelected = selectedModel === m.id;
                    const isClaude = m.id.startsWith("claude");
                    return (
                      <div
                        key={m.id}
                        onClick={() => handleModelChange(m.id)}
                        style={{
                          padding: "10px 14px",
                          borderRadius: "10px",
                          border: isSelected ? "2.5px solid var(--accent-color)" : "1px solid var(--border-color)",
                          background: isSelected ? "rgba(16, 163, 127, 0.06)" : "transparent",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          transition: "all 0.15s ease"
                        }}
                      >
                        <div style={{ flexGrow: 1, textAlign: "left" }}>
                          <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "6px" }}>
                            <span>{m.name}</span>
                            <span style={{ 
                              fontSize: "0.68rem", 
                              fontWeight: 500, 
                              color: "var(--text-secondary)", 
                              padding: "2px 6px", 
                              borderRadius: "4px", 
                              backgroundColor: isClaude ? "rgba(209, 115, 23, 0.12)" : "rgba(16, 163, 127, 0.12)",
                              border: isClaude ? "1px solid rgba(209, 115, 23, 0.2)" : "1px solid rgba(16, 163, 127, 0.2)"
                            }}>
                              {isClaude ? "Claude" : "OpenAI"}
                            </span>
                          </div>
                          <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)", marginTop: "2px" }}>{m.desc}</div>
                        </div>
                        {isSelected && (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-color)" strokeWidth="3.5" style={{ flexShrink: 0, marginLeft: "8px" }}><polyline points="20 6 9 17 4 12"></polyline></svg>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="form-group">
                <label>Custom Base URL</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={baseUrl} 
                  onChange={(e) => setBaseUrl(e.target.value)}
                  id="base-url-input"
                />
              </div>

              <div className="form-group">
                <label>AgentRouter API Key</label>
                <input 
                  type="password" 
                  className="form-input" 
                  value={apiKey} 
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  id="api-key-input"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button 
                className="btn-secondary" 
                onClick={testConnectivity}
                disabled={connectionStatus === "testing"}
                id="test-connection-btn"
              >
                {connectionStatus === "testing" ? "Testing..." : "Test Connection"}
              </button>
              <button className="btn-primary" onClick={saveSettings} id="save-settings-btn" style={{ background: "var(--accent-color)" }}>Save Settings</button>
            </div>
          </div>
        </div>
      )}

      {/* Workspace Files Selector Modal */}
      {isFilesModalOpen && (
        <div className="modal-overlay" onClick={() => setIsFilesModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ fontWeight: 600 }}>Attach Local Files</h3>
              <button className="btn-icon" onClick={() => setIsFilesModalOpen(false)} title="Close">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
            <div className="modal-body">
              <input 
                type="text" 
                className="form-input" 
                placeholder="Search files..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />

              {loadingFiles ? (
                <div style={{ textAlign: "center", padding: "12px", color: "var(--text-secondary)" }}>
                  Scanning folder...
                </div>
              ) : filteredFiles.length === 0 ? (
                <div style={{ textAlign: "center", padding: "12px", color: "var(--text-secondary)", fontSize: "0.85rem" }}>
                  No files found.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "2px", maxHeight: "260px", overflowY: "auto" }}>
                  {filteredFiles.map(file => {
                    const isAttached = !!attachedFiles.find(f => f.path === file.path);
                    return (
                      <div 
                        key={file.path} 
                        onClick={() => handleAttachFile(file)}
                        className="workspace-file-row"
                        style={{
                          backgroundColor: isAttached ? "var(--bg-card-hover)" : "transparent",
                          border: isAttached ? "1px solid var(--accent-color)" : "1px solid transparent"
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexGrow: 1 }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                          <div style={{ display: "flex", flexDirection: "column" }}>
                            <span style={{ fontSize: "0.82rem", fontWeight: isAttached ? 600 : 400 }}>{file.name}</span>
                            <span style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>{file.path}</span>
                          </div>
                        </div>
                        {isAttached && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent-color)" strokeWidth="3.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn-primary" onClick={() => setIsFilesModalOpen(false)} style={{ background: "var(--accent-color)" }}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
