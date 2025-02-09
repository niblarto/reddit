import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import { format } from 'date-fns';
import { networkInterfaces } from 'os';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import { initDatabase, loadFromDb, saveToDb } from './db.js';
import dotenv from 'dotenv';
import { setTimeout } from 'timers/promises';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get local IP address
function getLocalIP() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        if (net.address.startsWith('192.168.')) {
          return net.address;
        }
      }
    }
  }
  return '0.0.0.0';
}

const LOCAL_IP = getLocalIP();
console.log(`Local IP address: ${LOCAL_IP}`);

const app = express();

// Configure middleware
app.use(cookieParser());
app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

app.use(cors({
  origin: [
    'http://192.168.0.100:5173',
    'http://192.168.0.100:80',
    'http://192.168.0.100',
    'http://localhost:5173',
    'http://localhost:80',
    'http://localhost'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

app.use(express.json());

// Add error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const CONFIG_FILE = path.join(__dirname, 'config.json');

// Move config initialization to the top
let config = {
  filters: [{
    subreddit: 'UsenetInvites',
    keywords: [],
    excludedKeywords: ['[W]']
  }, {
    subreddit: 'CrackWatch',
    keywords: [],
    excludedKeywords: []
  }],
  telegramToken: '7326460997:AAG6Ipv3CnbyUhqql9IZ6PmECbEmfl2twas',
  chatId: '7446498644',
  notifiedPostIds: new Set(),
  hiddenPostIds: [],
  pinnedPostIds: [],
  username: 'admin',
  password: 'admin',
  hoursBack: 24,
  useDatabase: false
};

// Add the saveConfig function back
async function saveConfig(configToSave) {
  try {
    if (config.useDatabase) {
      await saveToDb(configToSave);
      return true;
    }

    console.log('Saving config:', configToSave);
    const sanitizedConfig = {
      filters: configToSave.filters || [],
      telegramToken: configToSave.telegramToken || '',
      chatId: configToSave.chatId || '',
      notifiedPostIds: Array.from(configToSave.notifiedPostIds || []),
      hiddenPostIds: configToSave.hiddenPostIds || [],
      pinnedPostIds: configToSave.pinnedPostIds || [],
      username: configToSave.username || 'admin',
      password: configToSave.password || 'admin',
      hoursBack: configToSave.hoursBack || 24,
      useDatabase: configToSave.useDatabase || false
    };

    // Write to temporary file first
    const tempFile = `${CONFIG_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(sanitizedConfig, null, 2), 'utf8');
    
    // Rename temp file to actual file (atomic operation)
    fs.renameSync(tempFile, CONFIG_FILE);
    console.log('Config saved successfully');
    return true;
  } catch (error) {
    console.error('Error saving config:', error);
    return false;
  }
}

// Update loadConfig function
async function loadConfig() {
  try {
    if (config.useDatabase) {
      const dbConfig = await loadFromDb();
      if (dbConfig) {
        // Update the existing config object instead of returning a new one
        Object.assign(config, dbConfig);
        return config;
      }
    }

    if (fs.existsSync(CONFIG_FILE)) {
      console.log('Loading config from:', CONFIG_FILE);
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      console.log('Raw config data:', data);
      
      // Try to load from config.json first
      const parsedConfig = JSON.parse(data);
      console.log('Parsed config:', parsedConfig);
      
      // Update the existing config object with loaded values
      config.filters = parsedConfig.filters || config.filters;
      config.telegramToken = parsedConfig.telegramToken || config.telegramToken;
      config.chatId = parsedConfig.chatId || config.chatId;
      config.notifiedPostIds = new Set(parsedConfig.notifiedPostIds || []);
      config.hiddenPostIds = parsedConfig.hiddenPostIds || config.hiddenPostIds;
      config.pinnedPostIds = parsedConfig.pinnedPostIds || config.pinnedPostIds;
      config.username = parsedConfig.username || config.username;
      config.password = parsedConfig.password || config.password;
      config.hoursBack = parsedConfig.hoursBack || config.hoursBack;
      config.useDatabase = parsedConfig.useDatabase || config.useDatabase;
    }
  } catch (error) {
    console.error('Error loading config:', error);
  }
  
  return config;
}

// Initialize config
console.log('Initializing config...');
config = await loadConfig();
console.log('Initial config loaded:', config);

// Initialize database if needed
if (config.useDatabase) {
  try {
    await initDatabase();
  } catch (error) {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  }
}

let stats = {
  pollCount: 0,
  totalMatches: 0,
  newMatches: 0,
  lastPollTime: Date.now(),
  lastError: null,
  isPolling: false,
  lastMatchCount: 0
};

// Authentication middleware
const requireAuth = (req, res, next) => {
  const isAuthenticated = req.cookies.isAuthenticated === 'true';
  if (!isAuthenticated) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// Add request timeout middleware
const timeout = (req, res, next) => {
  res.setTimeout(30000, () => {
    res.status(408).json({ error: 'Request timeout' });
  });
  next();
};

app.use(timeout);

// Login endpoint
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  if (username === config.username && password === config.password) {
    res.cookie('isAuthenticated', 'true', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

// Logout endpoint
app.post('/api/logout', (req, res) => {
  res.clearCookie('isAuthenticated');
  res.json({ success: true });
});

// Check auth status
app.get('/api/auth-status', (req, res) => {
  const isAuthenticated = req.cookies.isAuthenticated === 'true';
  res.json({ isAuthenticated });
});

// Protect all other API routes
app.use('/api', requireAuth);

app.get('/api/config', (req, res) => {
  console.log('Sending config to client:', {
    ...config,
    notifiedPostIds: Array.from(config.notifiedPostIds)
  });
  res.json({
    ...config,
    notifiedPostIds: Array.from(config.notifiedPostIds)
  });
});

app.get('/api/reddit/:subreddit', async (req, res) => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(`https://www.reddit.com/r/${req.params.subreddit}/new.json`, {
      headers: {
        'User-Agent': 'Reddit Keyword Monitor/1.0'
      },
      signal: controller.signal
    });

    clearTimeout(timeout);
    
    if (!response.ok) {
      throw new Error(`Reddit API returned ${response.status}`);
    }

    const data = await response.json();
    
    const posts = data.data.children.map(child => child.data);
    posts.sort((a, b) => b.created_utc - a.created_utc);
    
    res.json({
      ...data,
      data: {
        ...data.data,
        children: posts.map(post => ({ data: post }))
      }
    });
  } catch (error) {
    console.error('Error fetching from Reddit:', error);
    res.status(error.name === 'AbortError' ? 408 : 500)
       .json({ error: 'Failed to fetch from Reddit' });
  }
});

// Add pin/unpin endpoints
app.post('/api/posts/:id/pin', (req, res) => {
  const postId = req.params.id;
  if (!config.pinnedPostIds.includes(postId)) {
    config.pinnedPostIds.push(postId);
    saveConfig(config);
  }
  res.json({ success: true });
});

app.post('/api/posts/:id/unpin', (req, res) => {
  const postId = req.params.id;
  config.pinnedPostIds = config.pinnedPostIds.filter(id => id !== postId);
  saveConfig(config);
  res.json({ success: true });
});

app.post('/api/config', (req, res) => {
  try {
    console.log('Received config update:', req.body);
    const updates = req.body;
    
    const newConfig = {
      ...config,
      ...updates,
      notifiedPostIds: config.notifiedPostIds // Preserve the Set
    };

    console.log('New config:', newConfig);

    if (saveConfig(newConfig)) {
      config = newConfig;
      res.json({ success: true });
    } else {
      res.status(500).json({ 
        success: false, 
        error: 'Failed to save configuration' 
      });
    }
  } catch (error) {
    console.error('Error updating config:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
});

// Add export/import endpoints
app.get('/api/config/export', (req, res) => {
  try {
    const exportConfig = {
      ...config,
      notifiedPostIds: Array.from(config.notifiedPostIds)
    };
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=reddit-monitor-backup-${new Date().toISOString().slice(0, 10)}.json`);
    res.send(JSON.stringify(exportConfig, null, 2));
  } catch (error) {
    console.error('Error exporting config:', error);
    res.status(500).json({ error: 'Failed to export configuration' });
  }
});

app.post('/api/config/import', express.text({ type: '*/*' }), (req, res) => {
  try {
    console.log('Received import data:', req.body);
    const importedConfig = JSON.parse(req.body);
    
    // Validate imported config
    if (!importedConfig.filters || !Array.isArray(importedConfig.filters)) {
      throw new Error('Invalid configuration format');
    }
    
    const newConfig = {
      ...importedConfig,
      notifiedPostIds: new Set(importedConfig.notifiedPostIds || [])
    };
    
    console.log('Importing new config:', newConfig);
    
    if (saveConfig(newConfig)) {
      config = newConfig;
      res.json({ success: true });
    } else {
      throw new Error('Failed to save imported configuration');
    }
  } catch (error) {
    console.error('Error importing config:', error);
    res.status(500).json({ error: 'Failed to import configuration' });
  }
});

app.get('/api/stats', (req, res) => {
  res.json({
    ...stats,
    nextPollIn: Math.max(0, Math.floor((stats.lastPollTime + 600000 - Date.now()) / 1000))
  });
});

app.get('/api/poll', async (req, res) => {
  try {
    await checkRedditPosts();
    stats.lastPollTime = Date.now();
    res.json({ success: true });
  } catch (error) {
    console.error('Error during manual poll:', error);
    res.status(500).json({ error: 'Failed to poll Reddit' });
  }
});

async function sendTelegramNotification(post) {
  if (!config.telegramToken || !config.chatId) return;

  const isWithinTimeRange = (Date.now() / 1000) - post.created_utc < config.hoursBack * 60 * 60;
  if (!isWithinTimeRange) return;

  try {
    const postDate = new Date(post.created_utc * 1000);
    const message = `🔔 New matching post found!\n\nTitle: ${post.title}\nSubreddit: r/${post.subreddit}\nPosted: ${format(postDate, 'dd/MM/yyyy HH:mm:ss')}\nLink: https://reddit.com${post.permalink}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    await fetch(`https://api.telegram.org/bot${config.telegramToken}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: config.chatId,
        text: message,
        disable_web_page_preview: false,
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);
  } catch (error) {
    console.error('Failed to send Telegram notification:', error);
  }
}

async function postMatchesFilters(post) {
  const subredditFilters = config.filters.find(f => f.subreddit === post.subreddit);
  if (!subredditFilters) {
    console.log(`No filters found for subreddit: ${post.subreddit}`);
    return false;
  }

  const title = post.title.toLowerCase();
  console.log(`\nChecking post: "${post.title}" (${post.id}) from r/${post.subreddit}`);
  console.log(`Current pinned posts: [${config.pinnedPostIds.join(', ')}]`);
  console.log(`Keywords for r/${post.subreddit}: [${subredditFilters.keywords.join(', ')}]`);
  
  // Check if post matches any included keywords
  const hasIncludedKeyword = subredditFilters.keywords.some(keyword => {
    const lowerKeyword = keyword.toLowerCase();
    const matches = title.includes(lowerKeyword);
    console.log(`- Checking keyword "${keyword}": ${matches ? '✓' : '✗'}`);
    return matches;
  });
  
  // If no keywords are specified, don't auto-pin
  if (subredditFilters.keywords.length === 0) {
    console.log('No keywords specified - skipping auto-pin');
    return true;
  }
  
  // Check if post has any excluded keywords
  const hasExcludedKeyword = subredditFilters.excludedKeywords.some(keyword => {
    const matches = title.includes(keyword.toLowerCase());
    if (matches) {
      console.log(`- Found excluded keyword "${keyword}"`);
    }
    return matches;
  });

  const shouldPin = hasIncludedKeyword && !hasExcludedKeyword;
  const alreadyPinned = config.pinnedPostIds.includes(post.id);

  console.log('Decision process:');
  console.log(`- Has included keyword: ${hasIncludedKeyword}`);
  console.log(`- Has excluded keyword: ${hasExcludedKeyword}`);
  console.log(`- Already pinned: ${alreadyPinned}`);
  console.log(`- Should pin: ${shouldPin}`);

  // If post matches criteria and isn't already pinned, add it to pinnedPostIds
  if (shouldPin && !alreadyPinned) {
    console.log(`✓ Pinning post "${post.title}" (${post.id})`);
    config.pinnedPostIds.push(post.id);
    try {
      await saveConfig(config);
      console.log(`✓ Successfully pinned and saved post "${post.title}" (${post.id})`);
      console.log(`Updated pinned posts: [${config.pinnedPostIds.join(', ')}]`);
    } catch (error) {
      console.error('Error saving config after pinning:', error);
      // Remove the post ID if save failed
      config.pinnedPostIds = config.pinnedPostIds.filter(id => id !== post.id);
    }
  }

  return true; // Keep showing all posts in the UI
}

async function cleanupNotifiedPosts() {
  try {
    console.log('Starting hourly cleanup of notified posts...');
    const startTime = Date.now();
    const initialCount = config.notifiedPostIds.size;

    const allPosts = await Promise.all(
      config.filters.map(async ({ subreddit }) => {
        try {
          const response = await fetch(`https://www.reddit.com/r/${subreddit}/new.json?limit=100`, {
            headers: {
              'User-Agent': 'Reddit Keyword Monitor/1.0'
            }
          });

          if (!response.ok) {
            throw new Error(`Reddit API returned ${response.status}`);
          }

          const data = await response.json();
          return data.data.children.map(child => child.data);
        } catch (error) {
          console.error(`Error fetching posts from r/${subreddit}:`, error);
          return [];
        }
      })
    );

    const validPosts = new Set(allPosts.flat().map(post => post.id));
    const now = Date.now() / 1000;

    const newNotifiedPostIds = new Set(
      Array.from(config.notifiedPostIds).filter(id => {
        if (config.pinnedPostIds.includes(id)) {
          return true;
        }
        if (validPosts.has(id)) {
          return true;
        }
        return false;
      })
    );

    if (newNotifiedPostIds.size !== initialCount) {
      config.notifiedPostIds = newNotifiedPostIds;
      saveConfig(config);
      console.log(`Cleanup complete: Removed ${initialCount - newNotifiedPostIds.size} old post IDs`);
      console.log(`Time taken: ${(Date.now() - startTime) / 1000} seconds`);
    } else {
      console.log('Cleanup complete: No changes needed');
    }
  } catch (error) {
    console.error('Error during cleanup:', error);
  }
}

async function fetchWithRetry(url, options, retries = 3, delay = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      
      if (response.status === 429) {
        console.log(`Rate limited, waiting ${delay}ms before retry ${i + 1}/${retries}`);
        await setTimeout(delay);
        // Increase delay exponentially for next retry
        delay *= 2;
        continue;
      }
      
      if (!response.ok) {
        throw new Error(`Reddit API returned ${response.status}`);
      }
      
      return response;
    } catch (error) {
      if (i === retries - 1) throw error;
      console.log(`Request failed, retrying in ${delay}ms (${i + 1}/${retries})`);
      await setTimeout(delay);
      delay *= 2;
    }
  }
}

async function checkRedditPosts() {
  if (stats.isPolling) {
    console.log('Skipping poll: previous poll still in progress');
    return;
  }

  console.log('\n=== Starting Reddit post check ===');
  console.log('Current filters:', JSON.stringify(config.filters, null, 2));
  console.log('Currently pinned posts:', config.pinnedPostIds);

  stats.isPolling = true;
  stats.lastError = null;

  try {
    // Process subreddits sequentially to avoid rate limits
    const allPosts = [];
    for (const { subreddit } of config.filters) {
      try {
        console.log(`\nFetching posts from r/${subreddit}...`);
        const response = await fetchWithRetry(
          `https://www.reddit.com/r/${subreddit}/new.json?limit=100`,
          {
            headers: {
              'User-Agent': 'Reddit Keyword Monitor/1.0'
            }
          }
        );

        const data = await response.json();
        const posts = data.data.children.map(child => child.data);
        console.log(`Retrieved ${posts.length} posts from r/${subreddit}`);
        allPosts.push(...posts);
        
        // Add delay between subreddit requests
        await setTimeout(2000);
      } catch (error) {
        console.error(`Error fetching posts from r/${subreddit}:`, error);
      }
    }

    const posts = allPosts.sort((a, b) => b.created_utc - a.created_utc);
    
    const now = Date.now() / 1000;
    const recentPosts = posts.filter(post => now - post.created_utc <= config.hoursBack * 60 * 60);
    
    console.log(`\nChecking ${recentPosts.length} recent posts for pinning criteria...`);
    
    // Process posts sequentially
    for (const post of recentPosts) {
      await postMatchesFilters(post);
    }
    
    console.log('\nPinning summary:');
    console.log(`- Total posts checked: ${recentPosts.length}`);
    console.log(`- Total pinned posts: ${config.pinnedPostIds.length}`);
    console.log(`- Pinned post IDs: [${config.pinnedPostIds.join(', ')}]`);

    stats.pollCount++;
    stats.lastPollTime = Date.now();
    stats.totalMatches = recentPosts.length;
    stats.lastMatchCount = recentPosts.length;

    await saveConfig(config);
  } catch (error) {
    console.error('Error checking Reddit posts:', error);
    stats.lastError = error.message;
  } finally {
    stats.isPolling = false;
    console.log('=== Reddit post check complete ===\n');
  }
}

const POLL_INTERVAL = 10 * 60 * 1000;
const CLEANUP_INTERVAL = 60 * 60 * 1000;

process.on('SIGTERM', () => {
  console.log('Received SIGTERM. Performing graceful shutdown...');
  saveConfig(config);
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT. Performing graceful shutdown...');
  saveConfig(config);
  process.exit(0);
});

// Add the Telegram test endpoint
app.post('/api/telegram/test', async (req, res) => {
  try {
    const { telegramToken, chatId } = req.body;

    if (!telegramToken || !chatId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required parameters' 
      });
    }

    // Create test message
    const message = `🔔 Test notification from Reddit Keyword Monitor\n\n` +
      `If you received this message, your Telegram notifications are working correctly!\n\n` +
      `Time: ${new Date().toISOString()}`;

    const response = await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        disable_web_page_preview: false,
      }),
    });

    const data = await response.json();

    if (data.ok) {
      res.json({ success: true });
    } else {
      res.json({ 
        success: false, 
        error: data.description || 'Failed to send Telegram message' 
      });
    }
  } catch (error) {
    console.error('Error sending Telegram test message:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error while sending Telegram message' 
    });
  }
});

// Add this endpoint to get posts
app.get('/api/posts', requireAuth, async (req, res) => {
  try {
    const allPosts = [];
    for (const { subreddit } of config.filters) {
      try {
        const response = await fetchWithRetry(
          `https://www.reddit.com/r/${subreddit}/new.json?limit=100`,
          {
            headers: {
              'User-Agent': 'Reddit Keyword Monitor/1.0'
            }
          }
        );

        const data = await response.json();
        const posts = data.data.children.map(child => ({
          id: child.data.id,
          title: child.data.title,
          url: child.data.url,
          permalink: child.data.permalink,
          created_utc: child.data.created_utc,
          subreddit: child.data.subreddit
        }));
        allPosts.push(...posts);
        
        // Add delay between requests
        await setTimeout(2000);
      } catch (error) {
        console.error(`Error fetching posts from r/${subreddit}:`, error);
      }
    }

    const posts = allPosts.sort((a, b) => b.created_utc - a.created_utc);
    
    const now = Date.now() / 1000;
    const recentPosts = posts.filter(post => 
      now - post.created_utc <= config.hoursBack * 60 * 60
    );

    res.json(recentPosts);
  } catch (error) {
    console.error('Error fetching posts:', error);
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

// Add endpoints for pinning/unpinning posts
app.post('/api/posts/:id/pin', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!config.pinnedPostIds.includes(id)) {
      config.pinnedPostIds.push(id);
      await saveConfig(config);
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error pinning post:', error);
    res.status(500).json({ error: 'Failed to pin post' });
  }
});

app.post('/api/posts/:id/unpin', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    config.pinnedPostIds = config.pinnedPostIds.filter(pinnedId => pinnedId !== id);
    await saveConfig(config);
    res.json({ success: true });
  } catch (error) {
    console.error('Error unpinning post:', error);
    res.status(500).json({ error: 'Failed to unpin post' });
  }
});

// Add endpoint for hiding posts
app.post('/api/posts/:id/hide', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    config.hiddenPostIds.push(id);
    await saveConfig(config);
    res.json({ success: true });
  } catch (error) {
    console.error('Error hiding post:', error);
    res.status(500).json({ error: 'Failed to hide post' });
  }
});

// Start the server
const PORT = process.env.SERVER_PORT || 3001;
const server = app.listen(PORT, LOCAL_IP, () => {
  console.log(`Server running on http://${LOCAL_IP}:${PORT}`);
  checkRedditPosts();
  setInterval(checkRedditPosts, POLL_INTERVAL);
  setInterval(cleanupNotifiedPosts, CLEANUP_INTERVAL);
});

server.timeout = 30000;

export default app;
