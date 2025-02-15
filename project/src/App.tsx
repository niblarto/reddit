import React, { useState, useEffect, useRef } from 'react';
import { Bell, Search, Settings, Plus, Minus, Save, X, Eye, RefreshCw, Download, Upload, Clock, Lock, Pin, PinOff } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';

// Update the API_URL to use the correct port
const API_URL = `http://${window.location.hostname}:3001`;

const fetchConfig = {
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  },
  mode: 'cors' as RequestMode,
  credentials: 'include' as RequestCredentials
};

interface SubredditFilters {
  subreddit: string;
  keywords: string[];
  excludedKeywords: string[];
}

interface Post {
  id: string;
  title: string;
  url: string;
  permalink: string;
  created_utc: number;
  subreddit: string;
}

interface Config {
  filters: SubredditFilters[];
  telegramToken: string;
  chatId: string;
  hiddenPostIds: string[];
  hoursBack: number;
  username: string;
  password: string;
  pinnedPostIds: string[];
  useDatabase: boolean;
}

// Login page component
function LoginPage({ onLogin }: { onLogin: () => void }) {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const response = await fetch(`${API_URL}/api/login`, {
        ...fetchConfig,
        method: 'POST',
        body: JSON.stringify({ username, password })
      });

      if (response.ok) {
        await queryClient.invalidateQueries();
        onLogin();
      } else {
        setError('Invalid username or password');
      }
    } catch (error) {
      setError('Failed to login. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="max-w-md w-full p-6">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <div className="flex items-center justify-center mb-8">
            <Lock className="w-12 h-12 text-blue-500" />
          </div>
          <h1 className="text-2xl font-bold text-center text-gray-800 mb-8">
            Reddit Keyword Monitor
          </h1>
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">
                {error}
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className={`w-full px-4 py-2 text-white font-medium rounded-lg transition-colors ${
                isLoading ? 'bg-gray-400' : 'bg-blue-500 hover:bg-blue-600'
              }`}
            >
              {isLoading ? 'Logging in...' : 'Login'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function App() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'monitor' | 'settings'>('monitor');
  const [isPolling, setIsPolling] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  
  const { data: serverConfig, isLoading: isConfigLoading } = useQuery({
    queryKey: ['config'],
    queryFn: async () => {
      const response = await fetch(`${API_URL}/api/config`, fetchConfig);
      if (!response.ok) {
        throw new Error('Failed to load config');
      }
      return response.json() as Promise<Config>;
    },
    retry: false
  });

  const { data: stats = { pollCount: 0, totalMatches: 0, newMatches: 0, nextPollIn: 0 }, refetch: refetchStats } = useQuery({
    queryKey: ['stats'],
    queryFn: async () => {
      const response = await fetch(`${API_URL}/api/stats`, fetchConfig);
      return response.json();
    },
    refetchInterval: 1000,
  });

  const [filters, setFilters] = useState<SubredditFilters[]>([]);
  const [newSubreddit, setNewSubreddit] = useState('');
  const [newKeyword, setNewKeyword] = useState('');
  const [newExcludedKeyword, setNewExcludedKeyword] = useState('');
  const [selectedSubreddit, setSelectedSubreddit] = useState<string | null>(null);
  const [telegramToken, setTelegramToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [testStatus, setTestStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [hiddenPostIds, setHiddenPostIds] = useState<Set<string>>(new Set());
  const [pinnedPostIds, setPinnedPostIds] = useState<string[]>([]);
  const [hoursBack, setHoursBack] = useState(24);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [useDatabase, setUseDatabase] = useState(false);

  // Check authentication status on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await fetch(`${API_URL}/api/auth-status`, fetchConfig);
        if (!response.ok) {
          setIsAuthenticated(false);
          return;
        }
        const data = await response.json();
        if (data.isAuthenticated) {
          setIsAuthenticated(true);
          await queryClient.invalidateQueries();
        } else {
          setIsAuthenticated(false);
        }
      } catch (error) {
        setIsAuthenticated(false);
      } finally {
        setIsCheckingAuth(false);
      }
    };
    checkAuth();
  }, [queryClient]);

  // Add logout function
  const handleLogout = async () => {
    try {
      await fetch(`${API_URL}/api/logout`, {
        ...fetchConfig,
        method: 'POST'
      });
      setIsAuthenticated(false);
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

  useEffect(() => {
    if (serverConfig) {
      const updatedFilters = (serverConfig.filters || []).map(filter => ({
        ...filter,
        keywords: filter.keywords || [],
        excludedKeywords: filter.excludedKeywords || []
      }));
      
      setFilters(updatedFilters);
      setTelegramToken(serverConfig.telegramToken || '');
      setChatId(serverConfig.chatId || '');
      setHiddenPostIds(new Set(serverConfig.hiddenPostIds || []));
      setPinnedPostIds(serverConfig.pinnedPostIds || []);
      setHoursBack(serverConfig.hoursBack || 24);
      setUsername(serverConfig.username || '');
      setPassword(serverConfig.password || '');
      setUseDatabase(serverConfig.useDatabase || false);
      
      if (updatedFilters.length > 0) {
        setSelectedSubreddit(updatedFilters[0].subreddit);
      }
    }
  }, [serverConfig]);

  const subreddits = filters.map(f => f.subreddit);

  const { data: allPosts = [], isLoading, error, refetch: refetchPosts } = useQuery({
    queryKey: ['posts', subreddits],
    queryFn: async () => {
      if (!subreddits.length) return [];
      
      const allPostsData = await Promise.all(
        subreddits.map(async (subreddit) => {
          try {
            const response = await fetch(`${API_URL}/api/reddit/${subreddit}`, fetchConfig);
            const data = await response.json();
            return data.data.children.map((child: any) => ({
              ...child.data,
              subreddit: child.data.subreddit
            }));
          } catch (error) {
            console.error(`Error fetching posts from r/${subreddit}:`, error);
            return [];
          }
        })
      );

      const posts = allPostsData.flat();
      return posts.sort((a, b) => b.created_utc - a.created_utc);
    },
    refetchInterval: 10 * 60 * 1000,
    enabled: subreddits.length > 0,
  });

  const forcePoll = async () => {
    if (isPolling) return;
    
    setIsPolling(true);
    try {
      await fetch(`${API_URL}/api/poll`, fetchConfig);
      await Promise.all([
        refetchStats(),
        refetchPosts()
      ]);
    } catch (error) {
      console.error('Error forcing poll:', error);
    } finally {
      setIsPolling(false);
    }
  };

  const togglePin = async (postId: string) => {
    const isPinned = pinnedPostIds.includes(postId);
    try {
      const response = await fetch(`${API_URL}/api/posts/${postId}/${isPinned ? 'unpin' : 'pin'}`, {
        ...fetchConfig,
        method: 'POST'
      });
      
      if (response.ok) {
        setPinnedPostIds(prev => 
          isPinned 
            ? prev.filter(id => id !== postId)
            : [...prev, postId]
        );
      }
    } catch (error) {
      console.error('Error toggling pin:', error);
    }
  };

  const matchingPosts = React.useMemo(() => {
    const posts = allPosts || [];
    const now = Date.now() / 1000;
    
    const pinnedPosts = posts.filter(post => pinnedPostIds.includes(post.id));
    
    const regularPosts = posts
      .filter(post => {
        if (pinnedPostIds.includes(post.id)) return false;
        
        if (now - post.created_utc > hoursBack * 60 * 60) return false;
        
        if (hiddenPostIds.has(post.id)) return false;
        
        const title = post.title.toLowerCase();
        const subredditFilters = filters.find(f => f.subreddit === post.subreddit);
        
        if (!subredditFilters) return false;
        
        if (subredditFilters.keywords.length === 0) {
          return !subredditFilters.excludedKeywords.some(keyword => 
            title.includes(keyword.toLowerCase())
          );
        }

        const hasIncludedKeyword = subredditFilters.keywords.some(keyword => 
          title.includes(keyword.toLowerCase())
        );
        const hasExcludedKeyword = subredditFilters.excludedKeywords.some(keyword =>
          title.includes(keyword.toLowerCase())
        );
        return hasIncludedKeyword && !hasExcludedKeyword;
      })
      .sort((a, b) => b.created_utc - a.created_utc);

    return [...pinnedPosts, ...regularPosts];
  }, [allPosts, filters, hiddenPostIds, hoursBack, pinnedPostIds]);

  const hidePost = async (postId: string) => {
    const updatedHiddenPosts = new Set(hiddenPostIds);
    updatedHiddenPosts.add(postId);
    setHiddenPostIds(updatedHiddenPosts);
    
    await fetch(`${API_URL}/api/config`, {
      ...fetchConfig,
      method: 'POST',
      body: JSON.stringify({ hiddenPostIds: Array.from(updatedHiddenPosts) }),
    });
  };

  const unhideAllPosts = async () => {
    setHiddenPostIds(new Set());
    
    await fetch(`${API_URL}/api/config`, {
      ...fetchConfig,
      method: 'POST',
      body: JSON.stringify({ hiddenPostIds: [] }),
    });
  };

  const exportConfig = async () => {
    try {
      const response = await fetch(`${API_URL}/api/config/export`, {
        ...fetchConfig,
        headers: {
          ...fetchConfig.headers,
          'Accept': 'application/octet-stream'
        }
      });
      
      if (!response.ok) throw new Error('Failed to export configuration');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `reddit-monitor-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error exporting config:', error);
      alert('Failed to export configuration');
    }
  };

  const importConfig = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const response = await fetch(`${API_URL}/api/config/import`, {
        ...fetchConfig,
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
        },
        body: text
      });

      if (!response.ok) throw new Error('Failed to import configuration');

      window.location.reload();
    } catch (error) {
      console.error('Error importing config:', error);
      alert('Failed to import configuration');
    }
  };

  const saveCurrentState = async () => {
    setSaveStatus('saving');
    try {
      const response = await fetch(`${API_URL}/api/config`, {
        ...fetchConfig,
        method: 'POST',
        body: JSON.stringify({
          filters,
          telegramToken,
          chatId,
          hiddenPostIds: Array.from(hiddenPostIds),
          hoursBack,
          pinnedPostIds,
          username,
          password
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save configuration');
      }

      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (error) {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };

  const addSubreddit = () => {
    if (newSubreddit && !subreddits.includes(newSubreddit)) {
      const updatedFilters = [
        ...filters,
        {
          subreddit: newSubreddit,
          keywords: [],
          excludedKeywords: []
        }
      ];
      setFilters(updatedFilters);
      setNewSubreddit('');
      setSelectedSubreddit(newSubreddit);
      
      fetch(`${API_URL}/api/config`, {
        ...fetchConfig,
        method: 'POST',
        body: JSON.stringify({ filters: updatedFilters }),
      });
    }
  };

  const removeSubreddit = (subreddit: string) => {
    if (filters.length <= 1) {
      alert('You must keep at least one subreddit to monitor');
      return;
    }
    
    const updatedFilters = filters.filter(f => f.subreddit !== subreddit);
    setFilters(updatedFilters);
    
    if (selectedSubreddit === subreddit) {
      setSelectedSubreddit(updatedFilters[0]?.subreddit || null);
    }
    
    fetch(`${API_URL}/api/config`, {
      ...fetchConfig,
      method: 'POST',
      body: JSON.stringify({ filters: updatedFilters }),
    });
  };

  const addKeyword = () => {
    if (!selectedSubreddit || !newKeyword) return;
    
    const updatedFilters = filters.map(f => {
      if (f.subreddit === selectedSubreddit && !f.keywords.includes(newKeyword)) {
        return {
          ...f,
          keywords: [...f.keywords, newKeyword]
        };
      }
      return f;
    });
    
    setFilters(updatedFilters);
    setNewKeyword('');
    
    fetch(`${API_URL}/api/config`, {
      ...fetchConfig,
      method: 'POST',
      body: JSON.stringify({ filters: updatedFilters }),
    });
  };

  const removeKeyword = (subreddit: string, keyword: string) => {
    const updatedFilters = filters.map(f => {
      if (f.subreddit === subreddit) {
        return {
          ...f,
          keywords: f.keywords.filter(k => k !== keyword)
        };
      }
      return f;
    });
    
    setFilters(updatedFilters);
    
    fetch(`${API_URL}/api/config`, {
      ...fetchConfig,
      method: 'POST',
      body: JSON.stringify({ filters: updatedFilters }),
    });
  };

  const addExcludedKeyword = () => {
    if (!selectedSubreddit || !newExcludedKeyword) return;
    
    const updatedFilters = filters.map(f => {
      if (f.subreddit === selectedSubreddit && !f.excludedKeywords.includes(newExcludedKeyword)) {
        return {
          ...f,
          excludedKeywords: [...f.excludedKeywords, newExcludedKeyword]
        };
      }
      return f;
    });
    
    setFilters(updatedFilters);
    setNewExcludedKeyword('');
    
    fetch(`${API_URL}/api/config`, {
      ...fetchConfig,
      method: 'POST',
      body: JSON.stringify({ filters: updatedFilters }),
    });
  };

  const removeExcludedKeyword = (subreddit: string, keyword: string) => {
    const updatedFilters = filters.map(f => {
      if (f.subreddit === subreddit) {
        return {
          ...f,
          excludedKeywords: f.excludedKeywords.filter(k => k !== keyword)
        };
      }
      return f;
    });
    
    setFilters(updatedFilters);
    
    fetch(`${API_URL}/api/config`, {
      ...fetchConfig,
      method: 'POST',
      body: JSON.stringify({ filters: updatedFilters }),
    });
  };

  const sendTestNotification = async () => {
    if (!telegramToken || !chatId) {
      alert('Please enter both Bot Token and Chat ID');
      return;
    }

    setTestStatus('loading');
    try {
      const response = await fetch(`${API_URL}/api/telegram/test`, {
        ...fetchConfig,
        method: 'POST',
        body: JSON.stringify({
          telegramToken,
          chatId
        }),
      });

      const data = await response.json();
      if (data.success) {
        setTestStatus('success');
      } else {
        throw new Error(data.error || 'Failed to send test message');
      }
    } catch (error) {
      setTestStatus('error');
      alert('Failed to send test message. Please check your Bot Token and Chat ID.');
    }

    setTimeout(() => setTestStatus('idle'), 3000);
  };

  if (isCheckingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-600">Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage onLogin={() => setIsAuthenticated(true)} />;
  }

  if (isConfigLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-600">Loading configuration...</p>
      </div>
    );
  }

  const selectedFilters = filters.find(f => f.subreddit === selectedSubreddit);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-white rounded-lg shadow-lg">
          {/* Header */}
          <div className="border-b border-gray-200">
            <div className="flex items-center justify-between p-6">
              <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                <Bell className="w-6 h-6" />
                Reddit Keyword Monitor
              </h1>
              <button
                onClick={handleLogout}
                className="px-4 py-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Logout
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-200">
              <button
                onClick={() => setActiveTab('monitor')}
                className={`px-6 py-3 font-medium text-sm transition-colors relative ${
                  activeTab === 'monitor'
                    ? 'text-blue-600'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Monitor
                {activeTab === 'monitor' && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600"></div>
                )}
              </button>
              <button
                onClick={() => setActiveTab('settings')}
                className={`px-6 py-3 font-medium text-sm transition-colors relative ${
                  activeTab === 'settings'
                    ? 'text-blue-600'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Settings
                {activeTab === 'settings' && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600"></div>
                )}
              </button>
              <button
                onClick={forcePoll}
                disabled={isPolling}
                className={`px-6 py-3 font-medium text-sm transition-colors relative flex items-center gap-1
                  ${isPolling ? 'text-gray-400 cursor-not-allowed' : 'text-gray-500 hover:text-gray-700'}`}
              >
                <RefreshCw className={`w-4 h-4 ${isPolling ? 'animate-spin' : ''}`} />
                Poll Now
              </button>
            </div>
          </div>

          <div className="p-6">
            {/* Status Section */}
            <div className="bg-gray-50 rounded-lg p-4 mb-6 grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="text-sm text-gray-600">Total Polls</div>
                <div className="text-2xl font-bold text-gray-800">{stats.pollCount}</div>
              </div>
              <div className="text-center">
                <div className="text-sm text-gray-600">Next Poll In</div>
                <div className="text-2xl font-bold text-gray-800">
                  {Math.floor(stats.nextPollIn / 60)}:{(stats.nextPollIn % 60).toString().padStart(2, '0')}
                </div>
              </div>
              <div className="text-center">
                <div className="text-sm text-gray-600">Total Matches</div>
                <div className="text-2xl font-bold text-gray-800">{stats.totalMatches}</div>
              </div>
              <div className="text-center">
                <div className="text-sm text-gray-600">New Matches</div>
                <div className="text-2xl font-bold text-blue-600">{stats.newMatches}</div>
              </div>
            </div>

            {activeTab === 'monitor' && (
              <div className="space-y-4">
                {isLoading && (
                  <div className="text-center text-gray-600">Loading posts...</div>
                )}
                {error && (
                  <div className="text-center text-red-600">Error loading posts</div>
                )}
                {matchingPosts.map(post => {
                  const postDate = new Date(post.created_utc * 1000);
                  const isPinned = pinnedPostIds.includes(post.id);
                  return (
                    <div 
                      key={post.id} 
                      className={`border border-gray-200 rounded-lg p-4 hover:bg-gray-50 relative ${
                        isPinned ? 'bg-yellow-50 hover:bg-yellow-100' : ''
                      }`}
                    >
                      <div className="absolute top-2 right-2 flex gap-2">
                        <button
                          onClick={() => togglePin(post.id)}
                          className={`p-1 rounded-full transition-colors ${
                            isPinned 
                              ? 'text-yellow-600 hover:text-yellow-700 hover:bg-yellow-100' 
                              : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                          }`}
                          aria-label={isPinned ? 'Unpin post' : 'Pin post'}
                        >
                          {isPinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => hidePost(post.id)}
                          className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full"
                          aria-label="Hide post"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <a
                        href={`https://reddit.com${post.permalink}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-sm font-medium text-purple-600">r/{post.subreddit}</span>
                          <span className="text-gray-400">•</span>
                          <span className="text-sm text-gray-600">
                            Posted {format(postDate, 'dd/MM/yyyy HH:mm:ss')}
                          </span>
                        </div>
                        <h2 className="text-lg font-semibold text-gray-800">{post.title}</h2>
                      </a>
                    </div>
                  );
                })}
                {matchingPosts.length === 0 && !isLoading && (
                  <div className="text-center text-gray-600">
                    No matching posts found in the last {hoursBack} hours
                  </div>
                )}
              </div>
            )}

            {activeTab === 'settings' && (
              <div className="space-y-8">
                {/* Save/Load/Export Buttons */}
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={unhideAllPosts}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-white bg-green-500 hover:bg-green-600 transition-colors"
                    >
                      <Eye className="w-4 h-4" />
                      Show Hidden Posts ({hiddenPostIds.size})
                    </button>
                    <button
                      onClick={exportConfig}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-white bg-purple-500 hover:bg-purple-600 transition-colors"
                    >
                      <Download className="w-4 h-4" />
                      Export Settings
                    </button>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-white bg-purple-500 hover:bg-purple-600 transition-colors"
                    >
                      <Upload className="w-4 h-4" />
                      Import Settings
                    </button>
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={importConfig}
                      accept=".json"
                      className="hidden"
                    />
                  </div>
                  <button
                    onClick={saveCurrentState}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-white transition-colors ${
                      saveStatus === 'saving'
                        ? 'bg-gray-400'
                        : saveStatus === 'success'
                        ? 'bg-green-500'
                        : saveStatus === 'error'
                        ? 'bg-red-500'
                        : 'bg-blue-500 hover:bg-blue-600'
                    }`}
                    disabled={saveStatus === 'saving'}
                  >
                    <Save className="w-4 h-4" />
                    {saveStatus === 'saving'
                      ? 'Saving...'
                      : saveStatus === 'success'
                      ? 'Saved!'
                      : saveStatus === 'error'
                      ? 'Error!'
                      : 'Save Changes'}
                  </button>
                </div>

                {/* Authentication Settings */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-gray-800">Authentication Settings</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Username
                      </label>
                      <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="Enter username"
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Password
                      </label>
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter password"
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                </div>

                {/* Subreddit Settings */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-gray-800">Subreddit Settings</h3>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newSubreddit}
                      onChange={(e) => setNewSubreddit(e.target.value)}
                      placeholder="Enter subreddit name"
                      className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      onClick={addSubreddit}
                      className="flex items-center gap-2 px-4 py-2 text-white bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                      Add
                    </button>
                  </div>
                  <div className="space-y-2">
                    {filters.map((filter) => (
                      <div
                        key={filter.subreddit}
                        className={`p-4 border border-gray-200 rounded-lg ${
                          selectedSubreddit === filter.subreddit ? 'bg-blue-50' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between mb-4">
                          <button
                            onClick={() => setSelectedSubreddit(filter.subreddit)}
                            className="text-lg font-medium text-gray-800 hover:text-blue-600"
                          >
                            r/{filter.subreddit}
                          </button>
                          <button
                            onClick={() => removeSubreddit(filter.subreddit)}
                            className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-colors"
                          >
                            <X className="w-5 h-5" />
                          </button>
                        </div>
                        {selectedSubreddit === filter.subreddit && (
                          <div className="space-y-4">
                            <div>
                              <div className="flex items-center gap-2 mb-2">
                                <h4 className="text-sm font-medium text-gray-700">Auto-Pin Keywords</h4>
                                <span className="text-xs text-gray-500">
                                  (Posts matching these keywords will be automatically pinned)
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={newKeyword}
                                  onChange={(e) => setNewKeyword(e.target.value)}
                                  placeholder="Enter keyword"
                                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                                <button
                                  onClick={addKeyword}
                                  className="flex items-center gap-2 px-4 py-2 text-white bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors"
                                >
                                  <Plus className="w-4 h-4" />
                                  Add
                                </button>
                              </div>
                              <div className="flex flex-wrap gap-2 mt-2">
                                {filter.keywords.map((keyword) => (
                                  <span
                                    key={keyword}
                                    className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-sm"
                                  >
                                    {keyword}
                                    <button
                                      onClick={() => removeKeyword(filter.subreddit, keyword)}
                                      className="p-0.5 hover:bg-blue-200 rounded-full"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  </span>
                                ))}
                              </div>
                            </div>
                            <div>
                              <div className="flex items-center gap-2 mb-2">
                                <h4 className="text-sm font-medium text-gray-700">
                                  Excluded Keywords
                                </h4>
                                <span className="text-xs text-gray-500">
                                  (Posts containing these keywords will be ignored)
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={newExcludedKeyword}
                                  onChange={(e) => setNewExcludedKeyword(e.target.value)}
                                  placeholder="Enter keyword to exclude"
                                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                                <button
                                  onClick={addExcludedKeyword}
                                  className="flex items-center gap-2 px-4 py-2 text-white bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors"
                                >
                                  <Plus className="w-4 h-4" />
                                  Add
                                </button>
                              </div>
                              <div className="flex flex-wrap gap-2 mt-2">
                                {filter.excludedKeywords.map((keyword) => (
                                  <span
                                    key={keyword}
                                    className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-800 rounded-full text-sm"
                                  >
                                    {keyword}
                                    <button
                                      onClick={() => removeExcludedKeyword(filter.subreddit, keyword)}
                                      className="p-0.5 hover:bg-red-200 rounded-full"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Telegram Settings */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-gray-800">Telegram Settings</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Bot Token
                      </label>
                      <input
                        type="text"
                        value={telegramToken}
                        onChange={(e) => setTelegramToken(e.target.value)}
                        placeholder="Enter your Telegram bot token"
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Chat ID
                      </label>
                      <input
                        type="text"
                        value={chatId}
                        onChange={(e) => setChatId(e.target.value)}
                        placeholder="Enter your Telegram chat ID"
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <button
                      onClick={sendTestNotification}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-white transition-colors ${
                        testStatus === 'loading'
                          ? 'bg-gray-400'
                          : testStatus === 'success'
                          ? 'bg-green-500'
                          : testStatus === 'error'
                          ? 'bg-red-500'
                          : 'bg-blue-500 hover:bg-blue-600'
                      }`}
                      disabled={testStatus === 'loading'}
                    >
                      <Bell className="w-4 h-4" />
                      {testStatus === 'loading'
                        ? 'Sending...'
                        : testStatus === 'success'
                        ? 'Sent!'
                        : testStatus === 'error'
                        ? 'Failed!'
                        : 'Send Test Notification'}
                    </button>
                  </div>
                </div>

                {/* Time Settings */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-gray-800">Time Settings</h3>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Hours to Look Back
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        max="168"
                        value={hoursBack}
                        onChange={(e) => setHoursBack(parseInt(e.target.value, 10))}
                        className="w-24 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-600">hours</span>
                    </div>
                  </div>
                </div>

                {/* Storage Settings */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-gray-800">Storage Settings</h3>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="useDatabase"
                      checked={useDatabase}
                      onChange={(e) => {
                        setUseDatabase(e.target.checked);
                        fetch(`${API_URL}/api/config`, {
                          ...fetchConfig,
                          method: 'POST',
                          body: JSON.stringify({ useDatabase: e.target.checked }),
                        });
                      }}
                      className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                    />
                    <label htmlFor="useDatabase" className="text-sm text-gray-700">
                      Use PostgreSQL Database (requires restart)
                    </label>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
