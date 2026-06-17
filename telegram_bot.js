bot.on('message', (msg) => {
  console.log("MSG:", msg.text);
  bot.sendMessage(msg.chat.id, "اشتغل ✔");
});
