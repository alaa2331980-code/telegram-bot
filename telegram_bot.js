// ==========================================
// بوت تيليجرام - خدمات AI + إشارات تداول
// ==========================================
// المتطلبات: node-telegram-bot-api
// تشغيل: node telegram_bot.js
// ==========================================

const TelegramBot = require('node-telegram-bot-api');
const https = require('https');

// =================== الإعدادات ===================
const BOT_TOKEN = '8780661149:AAHrPfSfJpS18RVoXZ5b4Vj9mtFJ8kgRRGQ';
const ADMIN_CHAT_ID = '5941806593';
const GROQ_API_KEY = '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';
const GROQ_MODEL = 'llama3-70b-8192';

// =================== تشغيل البوت ===================
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// قاعدة بيانات بسيطة في الذاكرة
const subscribers = new Set(); // المشتركين في الإشارات
const userStates = {};         // حالة كل مستخدم

console.log('✅ البوت شغال!');

// =================== دالة Groq AI ===================
async function askGroq(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        {
          role: 'system',
          content: 'أنت مساعد محترف متخصص في كتابة المحتوى العربي. اكتب بأسلوب احترافي وواضح.'
        },
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
        try {
          const json = JSON.parse(data);
          resolve(json.choices[0].message.content);
        } catch (e) {
          reject('خطأ في تحليل الرد');
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// =================== القائمة الرئيسية ===================
function getMainMenu(isAdmin = false) {
  const keyboard = [
    [{ text: '✍️ كتابة مقال' }, { text: '💬 رد احترافي' }],
    [{ text: '🔄 ترجمة نص' }, { text: '📝 تلخيص' }],
    [{ text: '📊 الاشتراك في الإشارات' }, { text: 'ℹ️ عن البوت' }]
  ];

  if (isAdmin) {
    keyboard.push([{ text: '📡 إرسال إشارة تداول' }, { text: '👥 عدد المشتركين' }]);
  }

  return {
    reply_markup: {
      keyboard,
      resize_keyboard: true
    }
  };
}

// =================== /start ===================
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const isAdmin = chatId.toString() === ADMIN_CHAT_ID;
  const name = msg.from.first_name || 'صديقي';

  subscribers.add(chatId); // تسجيل تلقائي

  const welcome = isAdmin
    ? `👑 أهلاً بك يا أدمن!\n\nالبوت شغال وجاهز. عندك صلاحيات إرسال الإشارات وإدارة المشتركين.`
    : `👋 أهلاً ${name}!\n\nأنا بوت خدمات الذكاء الاصطناعي 🤖\n\nأقدر أساعدك في:\n✍️ كتابة مقالات احترافية\n💬 صياغة ردود\n🔄 ترجمة نصوص\n📊 إشارات التداول\n\nاختار من القائمة 👇`;

  bot.sendMessage(chatId, welcome, getMainMenu(isAdmin));
});

// =================== الأزرار الرئيسية ===================
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const isAdmin = chatId.toString() === ADMIN_CHAT_ID;

  if (!text || text.startsWith('/')) return;

  // --- حالة انتظار إدخال المستخدم ---
  if (userStates[chatId]) {
    const state = userStates[chatId];
    delete userStates[chatId];

    bot.sendMessage(chatId, '⏳ جاري المعالجة...');

    try {
      let prompt = '';

      if (state === 'article') {
        prompt = `اكتب مقالاً احترافياً عن: ${text}\n\nالمقال يجب أن يكون منظماً بمقدمة وعناصر رئيسية وخاتمة. استخدم اللغة العربية الفصحى.`;
      } else if (state === 'reply') {
        prompt = `اكتب رداً احترافياً ومهذباً على الرسالة التالية:\n"${text}"\n\nاجعل الرد مناسباً ومختصراً.`;
      } else if (state === 'translate') {
        prompt = `ترجم النص التالي إلى اللغة الإنجليزية بشكل احترافي:\n"${text}"`;
      } else if (state === 'summarize') {
        prompt = `لخص النص التالي في نقاط واضحة:\n"${text}"`;
      } else if (state === 'signal' && isAdmin) {
        // إرسال إشارة التداول للمشتركين
        const signalMsg = formatSignal(text);
        let count = 0;
        for (const subId of subscribers) {
          if (subId.toString() !== ADMIN_CHAT_ID) {
            try {
              await bot.sendMessage(subId, signalMsg, { parse_mode: 'HTML' });
              count++;
            } catch (e) {}
          }
        }
        bot.sendMessage(chatId, `✅ تم إرسال الإشارة لـ ${count} مشترك!`, getMainMenu(true));
        return;
      }

      const response = await askGroq(prompt);
      bot.sendMessage(chatId, response, getMainMenu(isAdmin));

    } catch (err) {
      bot.sendMessage(chatId, '❌ حدث خطأ، حاول مرة أخرى.', getMainMenu(isAdmin));
    }

    return;
  }

  // --- الأزرار ---
  switch (text) {
    case '✍️ كتابة مقال':
      userStates[chatId] = 'article';
      bot.sendMessage(chatId, '📝 اكتب موضوع المقال:', { reply_markup: { force_reply: true } });
      break;

    case '💬 رد احترافي':
      userStates[chatId] = 'reply';
      bot.sendMessage(chatId, '💬 اكتب الرسالة اللي عايز ترد عليها:', { reply_markup: { force_reply: true } });
      break;

    case '🔄 ترجمة نص':
      userStates[chatId] = 'translate';
      bot.sendMessage(chatId, '🔄 اكتب النص العربي للترجمة:', { reply_markup: { force_reply: true } });
      break;

    case '📝 تلخيص':
      userStates[chatId] = 'summarize';
      bot.sendMessage(chatId, '📝 الصق النص اللي عايز تلخصه:', { reply_markup: { force_reply: true } });
      break;

    case '📊 الاشتراك في الإشارات':
      subscribers.add(chatId);
      bot.sendMessage(chatId, '✅ تم اشتراكك في إشارات التداول!\n\nهتوصلك إشارات فور إرسالها 📈', getMainMenu(isAdmin));
      break;

    case 'ℹ️ عن البوت':
      bot.sendMessage(chatId,
        '🤖 <b>بوت خدمات AI + إشارات التداول</b>\n\n' +
        '📌 الخدمات المتاحة:\n' +
        '• كتابة مقالات احترافية\n' +
        '• صياغة ردود مهذبة\n' +
        '• ترجمة النصوص\n' +
        '• تلخيص المحتوى\n' +
        '• إشارات التداول المباشرة\n\n' +
        '⚡ مدعوم بذكاء اصطناعي متطور',
        { parse_mode: 'HTML', ...getMainMenu(isAdmin) }
      );
      break;

    // أزرار الأدمن
    case '📡 إرسال إشارة تداول':
      if (isAdmin) {
        userStates[chatId] = 'signal';
        bot.sendMessage(chatId,
          '📡 اكتب تفاصيل الإشارة:\n\nمثال:\nBTC/USDT صعود 🟢\nالدخول: 65000\nالهدف: 67000\nوقف الخسارة: 64000',
          { reply_markup: { force_reply: true } }
        );
      }
      break;

    case '👥 عدد المشتركين':
      if (isAdmin) {
        const count = subscribers.size - 1; // بدون الأدمن
        bot.sendMessage(chatId, `👥 عدد المشتركين: ${count > 0 ? count : 0}`, getMainMenu(true));
      }
      break;

    default:
      bot.sendMessage(chatId, 'اختار من القائمة 👇', getMainMenu(isAdmin));
  }
});

// =================== تنسيق إشارة التداول ===================
function formatSignal(text) {
  return `📊 <b>إشارة تداول جديدة</b>\n\n${text}\n\n⚠️ تنبيه: هذه الإشارات للأغراض التعليمية فقط. التداول ينطوي على مخاطر.`;
}

// =================== معالجة الأخطاء ===================
bot.on('polling_error', (error) => {
  console.error('خطأ في البوت:', error.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('خطأ غير متوقع:', reason);
});
