import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import { format } from 'date-fns';
import { networkInterfaces } from 'os';
import cookieParser from 'cookie-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get local IP address
// function getLocalIP() {
//   const nets = networkInterfaces();
//   for (const name of Object.keys(nets)) {
//     for (const net of nets[name]) {
//       if (net.family === 'IPv4' && !net.internal) {
//         if (net.address.startsWith('192.168.')) {
//           return net.address;
//         }
//       }
//     }
//   }
//   return '0.0.0.0';
// }

const LOCAL_IP = getLocalIP();
console.log(`Local IP address: ${LOCAL_IP}`);

const app = express();
app.use(cors({
  origin: '*',
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// Add error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const CONFIG_FILE = path.join(__dirname, 'config.json');

// Add file system error handling
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      console.log('Loading config from:', CONFIG_FILE);
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      console.log('Raw config data:', data);
      
      // Try to load from config.json first
      const parsedConfig = JSON.parse(data);
      console.log('Parsed config:', parsedConfig);
      
      // Merge with defaults to ensure all fields exist
      return {
        filters: parsedConfig.filters || [{
          subreddit: 'UsenetInvites',
          keywords: [],
          excludedKeywords: ['[W]']
        }, {
          subreddit: 'CrackWatch',
          keywords: [],
          excludedKeywords: []
        }],
        telegramToken: parsedConfig.telegramToken || '7326460997:AAG6Ipv3CnbyUhqql9IZ6PmECbEmfl2twas',
        chatId: parsedConfig.chatId || '7446498644',
        notifiedPostIds: new Set(parsedConfig.notifiedPostIds || []),
        hiddenPostIds: parsedConfig.hiddenPostIds || [],
        pinnedPostIds: parsedConfig.pinnedPostIds || [],
        username: parsedConfig.username || 'admin',
        password: parsedConfig.password || 'admin',
        hoursBack: parsedConfig.hoursBack || 24
      };
    }
  } catch (error) {
    console.error('Error loading config:', error);
  }
  
  // Return default config if loading fails
  return {
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
    hoursBack: 24
  };
}

function saveConfig(configToSave) {
  try {
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
      hoursBack: configToSave.hoursBack || 24
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

// Initialize config
console.log('Initializing config...');
let config = loadConfig();
console.log('Initial config loaded:', config);

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

function postMatchesFilters(post) {
  const title = post.title.toLowerCase();
  const subredditFilters = config.filters.find(f => f.subreddit === post.subreddit);
  
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

async function checkRedditPosts() {
  if (stats.isPolling) {
    console.log('Skipping poll: previous poll still in progress');
    return;
  }

  stats.isPolling = true;
  stats.lastError = null;

  try {
    const allPosts = await Promise.all(
      config.filters.map(async ({ subreddit }) => {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10000);

          const response = await fetch(`https://www.reddit.com/r/${subreddit}/new.json`, {
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
          return data.data.children.map(child => child.data);
        } catch (error) {
          console.error(`Error fetching posts from r/${subreddit}:`, error);
          return [];
        }
      })
    );

    const posts = allPosts.flat().sort((a, b) => b.created_utc - a.created_utc);
    
    const now = Date.now() / 1000;
    const matchingPosts = posts
      .filter(post => now - post.created_utc <= config.hoursBack * 60 * 60)
      .filter(postMatchesFilters);
    
    stats.pollCount++;
    stats.lastPollTime = Date.now();
    
    const currentMatchCount = matchingPosts.length;
    stats.newMatches = Math.max(0, currentMatchCount - stats.lastMatchCount);
    stats.totalMatches = currentMatchCount;
    stats.lastMatchCount = currentMatchCount;

    for (const post of matchingPosts) {
      if (!config.notifiedPostIds.has(post.id)) {
        await sendTelegramNotification(post);
        config.notifiedPostIds.add(post.id);
        saveConfig(config);
      }
    }
  } catch (error) {
    console.error('Error checking Reddit posts:', error);
    stats.lastError = error.message;
  } finally {
    stats.isPolling = false;
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

const PORT = process.env.PORT || 3001;
//const server = app.listen(PORT, LOCAL_IP, () => {
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://${LOCAL_IP}:${PORT}`);
  checkRedditPosts();
  setInterval(checkRedditPosts, POLL_INTERVAL);
  setInterval(cleanupNotifiedPosts, CLEANUP_INTERVAL);
});

server.timeout = 30000;