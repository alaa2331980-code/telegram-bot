const TelegramBot = require('node-telegram-bot-api');

const bot = new TelegramBot('YOUR_TOKEN', { polling: true });

console.log("BOT STARTED");

bot.on('message', (msg) => {
  console.log("GOT MESSAGE:", msg.text);
  bot.sendMessage(msg.chat.id, "🔥 100% شغال");
});
