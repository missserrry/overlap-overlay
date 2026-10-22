// Запуск сервера без Electron: оверлеи открываются в браузере или OBS.
//   npm run server        — живые данные iRacing, демо пока сим не в сессии
//   npm run demo          — всегда демо
const { startServer } = require('../src/server/server');

const demo = process.argv.includes('--demo') ? 'on' : 'auto';
startServer({ demo }).then((s) => {
  console.log(`Relative:  http://127.0.0.1:${s.port}/relative/`);
  console.log(`Standings: http://127.0.0.1:${s.port}/standings/`);
});
