// ... existing imports and code ...

// Add this endpoint to handle Telegram test notifications
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

// ... rest of the code ... 