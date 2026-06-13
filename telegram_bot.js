const TelegramBot = require('node-telegram-bot-api');
const https = require('https');

const BOT_TOKEN = '8780661149:AAHrPfSfJpS18RVoXZ5b4Vj9mtFJ8kgRRGQ';
const ADMIN_CHAT_ID = '5941806593';
const GROQ_API_KEY = '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';
const GROQ_MODEL = 'llama3-70b-8192';
const ADMIN_USERNAME = 'Qcc_22';
const INSTAPAY_NUMBER = '01153974711';

const PRICES = {
  article: 100,
  reply: 100,
  translate: 70,
  summarize: 70
};

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const subscribers = new Set();
const userStates = {};
const pendingPayments = {};

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
    [{ text: '✍️ كتابة مقال - 100 جنيه' }, { text: '💬 رد احترافي - 100 جنيه' }],
    [{ text: '🔄 ترجمة نص - 70 جنيه' }, { text: '📝 تلخيص - 70 جنيه' }],
    [{ text: '📊 الاشتراك في الإشارات' }, { text: '📞 تواصل مع الأدمن' }],
    [{ text: 'ℹ️ عن البوت' }]
  ];
  if (isAdmin) {
    keyboard.push([{ text: '📡 إرسال إشارة تداول' }, { text: '👥 عدد المشتركين' }]);
    keyboard.push([{ text: '✅ تأكيد دفع' }]);
  }
  return { reply_markup: { keyboard, resize_keyboard: true } };
}

function getPaymentMsg(service, price, chatId) {
  return `💳 لإتمام الخدمة، يرجى الدفع:\n\n💰 المبلغ: ${price} جنيه\n📱 InstaPay: ${INSTAPAY_NUMBER}\n\nبعد الدفع ابعت صورة الإيصال هنا وسيتم تأكيد طلبك. ✅`;
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
  if (!text && !msg.photo) return;
  if (text && text.startsWith('/')) return;

  // العميل بعت صورة إيصال
  if (msg.photo && pendingPayments[chatId]) {
    const payment = pendingPayments[chatId];
    bot.sendMessage(chatId, '⏳ تم استلام الإيصال، جاري التحقق من الدفع...');
    bot.sendMessage(ADMIN_CHAT_ID,
      `💳 طلب تأكيد دفع جديد!\n\n👤 العميل: ${msg.from.first_name} (${chatId})\n💰 المبلغ: ${payment.price} جنيه\n📋 الخدمة: ${payment.service}\n\nاضغط ✅ تأكيد دفع ثم ابعت ID العميل للتأكيد.`,
      getMainMenu(true)
    );
    bot.forwardMessage(ADMIN_CHAT_ID, chatId, msg.message_id);
    return;
  }

  // أدمن بيأكد دفع
  if (isAdmin && userStates[chatId] === 'confirm_payment') {
    delete userStates[chatId];
    const clientId = parseInt(text);
    if (pendingPayments[clientId]) {
      const payment = pendingPayments[clientId];
      delete pendingPayments[clientId];
      bot.sendMessage(chatId, '✅ تم التأكيد! جاري إرسال الخدمة للعميل...', getMainMenu(true));
      bot.sendMessage(clientId, '✅ تم تأكيد دفعك! جاري تنفيذ الخدمة...');
      bot.sendMessage(clientId, '⏳ جاري المعالجة...');
      try {
        const response = await askGroq(payment.prompt);
        bot.sendMessage(clientId, response, getMainMenu(false));
      } catch (err) {
        bot.sendMessage(clientId, '❌ حدث خطأ، تواصل مع الأدمن.', getMainMenu(false));
      }
    } else {
      bot.sendMessage(chatId, '❌ مش لاقي طلب لهذا العميل.', getMainMenu(true));
    }
    return;
  }

  if (userStates[chatId] && userStates[chatId] !== 'confirm_payment') {
    const state = userStates[chatId];
    delete userStates[chatId];

    let prompt = '';
    let price = 0;
    let serviceName = '';

    if (state === 'article') { prompt = `اكتب مقالاً احترافياً عن: ${text}`; price = PRICES.article; serviceName = 'كتابة مقال'; }
    else if (state === 'reply') { prompt = `اكتب رداً احترافياً على: "${text}"`; price = PRICES.reply; serviceName = 'رد احترافي'; }
    else if (state === 'translate') { prompt = `ترجم للإنجليزية: "${text}"`; price = PRICES.translate; serviceName = 'ترجمة نص'; }
    else if (state === 'summarize') { prompt = `لخص في نقاط: "${text}"`; price = PRICES.summarize; serviceName = 'تلخيص'; }
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

    if (prompt && !isAdmin) {
      pendingPayments[chatId] = { prompt, price, service: serviceName };
      bot.sendMessage(chatId, getPaymentMsg(serviceName, price, chatId));
      return;
    }

    if (prompt && isAdmin) {
      bot.sendMessage(chatId, '⏳ جاري المعالجة...');
      try {
        const response = await askGroq(prompt);
        bot.sendMessage(chatId, response, getMainMenu(true));
      } catch (err) {
        bot.sendMessage(chatId, '❌ حدث خطأ.', getMainMenu(true));
      }
    }
    return;
  }

  switch (text) {
    case '✍️ كتابة مقال - 100 جنيه':
      userStates[chatId] = 'article';
      bot.sendMessage(chatId, '📝 اكتب موضوع المقال:');
      break;
    case '💬 رد احترافي - 100 جنيه':
      userStates[chatId] = 'reply';
      bot.sendMessage(chatId, '💬 اكتب الرسالة:');
      break;
    case '🔄 ترجمة نص - 70 جنيه':
      userStates[chatId] = 'translate';
      bot.sendMessage(chatId, '🔄 اكتب النص:');
      break;
    case '📝 تلخيص - 70 جنيه':
      userStates[chatId] = 'summarize';
      bot.sendMessage(chatId, '📝 الصق النص:');
      break;
    case '📊 الاشتراك في الإشارات':
      subscribers.add(chatId);
      bot.sendMessage(chatId, '✅ تم اشتراكك! 📈', getMainMenu(isAdmin));
      break;
    case '📞 تواصل مع الأدمن':
      bot.sendMessage(chatId, `📞 للتواصل مع الأدمن:\n\n👤 @${ADMIN_USERNAME}`, getMainMenu(isAdmin));
      break;
    case 'ℹ️ عن البوت':
      bot.sendMessage(chatId, '🤖 <b>بوت خدمات AI</b>\n\n• مقال: 100 جنيه\n• رد احترافي: 100 جنيه\n• ترجمة: 70 جنيه\n• تلخيص: 70 جنيه', { parse_mode: 'HTML', ...getMainMenu(isAdmin) });
      break;
    case '📡 إرسال إشارة تداول':
      if (isAdmin) { userStates[chatId] = 'signal'; bot.sendMessage(chatId, '📡 اكتب الإشارة:'); }
      break;
    case '👥 عدد المشتركين':
      if (isAdmin) bot.sendMessage(chatId, `👥 المشتركين: ${Math.max(0, subscribers.size - 1)}`, getMainMenu(true));
      break;
    case '✅ تأكيد دفع':
      if (isAdmin) { userStates[chatId] = 'confirm_payment'; bot.sendMessage(chatId, '👤 ابعت Chat ID العميل اللي عايز تأكد دفعه:'); }
      break;
    default:
      bot.sendMessage(chatId, 'اختار من القائمة 👇', getMainMenu(isAdmin));
  }
});

bot.on('polling_error', (error) => console.error('خطأ:', error.message));
