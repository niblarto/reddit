import pg from 'pg';

const pool = new pg.Pool({
  user: 'postgres',
  password: 'database',
  host: 'localhost',
  port: 5432,
  database: 'reddit_monitor'
});

// Initialize database tables
export async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS config (
        id SERIAL PRIMARY KEY,
        filters JSONB,
        telegram_token TEXT,
        chat_id TEXT,
        notified_post_ids TEXT[],
        hidden_post_ids TEXT[],
        pinned_post_ids TEXT[],
        username TEXT,
        password TEXT,
        hours_back INTEGER
      );
    `);

    // Insert default config if none exists
    const result = await pool.query('SELECT * FROM config LIMIT 1');
    if (result.rows.length === 0) {
      await pool.query(`
        INSERT INTO config (
          filters, 
          telegram_token, 
          chat_id, 
          notified_post_ids, 
          hidden_post_ids, 
          pinned_post_ids, 
          username, 
          password, 
          hours_back
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        JSON.stringify([{
          subreddit: 'UsenetInvites',
          keywords: [],
          excludedKeywords: ['[W]']
        }, {
          subreddit: 'CrackWatch',
          keywords: [],
          excludedKeywords: []
        }]),
        '7326460997:AAG6Ipv3CnbyUhqql9IZ6PmECbEmfl2twas',
        '7446498644',
        [],
        [],
        [],
        'admin',
        'admin',
        24
      ]);
    }
  } catch (error) {
    console.error('Database initialization error:', error);
    throw error;
  }
}

export async function loadFromDb() {
  const result = await pool.query('SELECT * FROM config LIMIT 1');
  if (result.rows.length === 0) return null;
  
  const row = result.rows[0];
  return {
    filters: row.filters,
    telegramToken: row.telegram_token,
    chatId: row.chat_id,
    notifiedPostIds: new Set(row.notified_post_ids),
    hiddenPostIds: row.hidden_post_ids,
    pinnedPostIds: row.pinned_post_ids,
    username: row.username,
    password: row.password,
    hoursBack: row.hours_back
  };
}

export async function saveToDb(config) {
  await pool.query(`
    UPDATE config SET 
      filters = $1,
      telegram_token = $2,
      chat_id = $3,
      notified_post_ids = $4,
      hidden_post_ids = $5,
      pinned_post_ids = $6,
      username = $7,
      password = $8,
      hours_back = $9
    WHERE id = 1
  `, [
    JSON.stringify(config.filters),
    config.telegramToken,
    config.chatId,
    Array.from(config.notifiedPostIds),
    config.hiddenPostIds,
    config.pinnedPostIds,
    config.username,
    config.password,
    config.hoursBack
  ]);
} 