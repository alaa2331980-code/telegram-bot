const TelegramBot = require('node-telegram-bot-api');
const https = require('https');

const BOT_TOKEN = '8780661149:AAHrPfSfJpS18RVoXZ5b4Vj9mtFJ8kgRRGQ';
const ADMIN_CHAT_ID = '5941806593';
const GROQ_API_KEY = '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';
const GROQ_MODEL = 'llama3-70b-8192';
const ADMIN_USERNAME = 'Qcc_22';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const subscribers = new Set();
const userStates = {};

console.log('البوت شغال!');

async function askGroq(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: 'انت مساعد محترف متخصص في كتابة المحتوى العربي.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 1000
    });
    const options = {
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data).choices[0].message.content); }
        catch (e) { reject('خطأ في الرد'); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function getMainMenu(isAdmin = false) {
  const keyboard = [
    [{ text: '✍️ كتابة مقال' }, { text: '💬 رد احترافي' }],
    [{ text: '🔄 ترجمة نص' }, { text: '📝 تلخيص' }],
    [{ text: '📊 الاشتراك في الإشارات' }, { text: '📞 تواصل مع الأدمن' }],
    [{ text: 'ℹ️ عن البوت' }]
  ];
  if (isAdmin) {
    keyboard.push([{ text: '📡 إرسال إشارة تداول' }, { text: '👥 عدد المشتركين' }]);
  }
  return { reply_markup: { keyboard, resize_keyboard: true } };
}

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const isAdmin = chatId.toString() === ADMIN_CHAT_ID;
  const name = msg.from.first_name || 'صديقي';
  subscribers.add(chatId);
  const welcome = isAdmin
    ? `👑 أهلاً بك يا أدمن!\n\nالبوت شغال وجاهز.`
    : `👋 أهلاً ${name}!\n\nأنا بوت خدمات الذكاء الاصطناعي 🤖\n\nاختار من القائمة 👇`;
  bot.sendMessage(chatId, welcome, getMainMenu(isAdmin));
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const isAdmin = chatId.toString() === ADMIN_CHAT_ID;
  if (!text || text.startsWith('/')) return;

  if (userStates[chatId]) {
    const state = userStates[chatId];
    delete userStates[chatId];
    bot.sendMessage(chatId, '⏳ جاري المعالجة...');
    try {
      let prompt = '';
      if (state === 'article') prompt = `اكتب مقالاً احترافياً عن: ${text}`;
      else if (state === 'reply') prompt = `اكتب رداً احترافياً على: "${text}"`;
      else if (state === 'translate') prompt = `ترجم للإنجليزية: "${text}"`;
      else if (state === 'summarize') prompt = `لخص في نقاط: "${text}"`;
      else if (state === 'signal' && isAdmin) {
        const signalMsg = `📊 <b>إشارة تداول جديدة</b>\n\n${text}\n\n⚠️ للأغراض التعليمية فقط.`;
        let count = 0;
        for (const subId of subscribers) {
          if (subId.toString() !== ADMIN_CHAT_ID) {
            try { await bot.sendMessage(subId, signalMsg, { parse_mode: 'HTML' }); count++; } catch (e) {}
          }
        }
        bot.sendMessage(chatId, `✅ تم الإرسال لـ ${count} مشترك!`, getMainMenu(true));
        return;
      }
      const response = await askGroq(prompt);
      bot.sendMessage(chatId, response, getMainMenu(isAdmin));
    } catch (err) {
      bot.sendMessage(chatId, '❌ حدث خطأ، حاول مرة أخرى.', getMainMenu(isAdmin));
    }
    return;
  }

  switch (text) {
    case '✍️ كتابة مقال':
      userStates[chatId] = 'article';
      bot.sendMessage(chatId, '📝 اكتب موضوع المقال:');
      break;
    case '💬 رد احترافي':
      userStates[chatId] = 'reply';
      bot.sendMessage(chatId, '💬 اكتب الرسالة:');
      break;
    case '🔄 ترجمة نص':
      userStates[chatId] = 'translate';
      bot.sendMessage(chatId, '🔄 اكتب النص:');
      break;
    case '📝 تلخيص':
      userStates[chatId] = 'summarize';
      bot.sendMessage(chatId, '📝 الصق النص:');
      break;
    case '📊 الاشتراك في الإشارات':
      subscribers.add(chatId);
      bot.sendMessage(chatId, '✅ تم اشتراكك! 📈', getMainMenu(isAdmin));
      break;
    case '📞 تواصل مع الأدمن':
      bot.sendMessage(chatId, `📞 للتواصل مع الأدمن:\n\n👤 @${ADMIN_USERNAME}\n\nاضغط على الاسم للتواصل مباشرة.`, getMainMenu(isAdmin));
      break;
    case 'ℹ️ عن البوت':
      bot.sendMessage(chatId, '🤖 <b>بوت خدمات AI</b>\n\n• كتابة مقالات\n• ردود احترافية\n• ترجمة\n• تلخيص\n• إشارات تداول', { parse_mode: 'HTML', ...getMainMenu(isAdmin) });
      break;
    case '📡 إرسال إشارة تداول':
      if (isAdmin) { userStates[chatId] = 'signal'; bot.sendMessage(chatId, '📡 اكتب الإشارة:'); }
      break;
    case '👥 عدد المشتركين':
      if (isAdmin) bot.sendMessage(chatId, `👥 المشتركين: ${Math.max(0, subscribers.size - 1)}`, getMainMenu(true));
      break;
    default:
      bot.sendMessage(chatId, 'اختار من القائمة 👇', getMainMenu(isAdmin));
  }
});

bot.on('polling_error', (error) => console.error('خطأ:', error.message));
